/**
 * WhatsApp Bot - Vercel Serverless Function
 * Integración con Google Gemini API (gemini-3.5-flash)
 * CON MEMORIA DE CONVERSACIÓN Y PROMPT CONCISO
 */

// ============================================================
// CONFIGURACIÓN
// ============================================================

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

const TU_NOMBRE = "Lucas";
const LINK_CALCOM = "https://cal.com/lucasconclaridad/20min";
const NOMBRE_HUMANO = "Lucas";

// ============================================================
// MEMORIA DE CONVERSACIÓN (en producción usar Redis/Vercel KV)
// ============================================================

const conversations = new Map();
const MAX_HISTORY = 10;

function getConversation(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, []);
  }
  return conversations.get(phone);
}

function addToConversation(phone, role, text) {
  const history = getConversation(phone);
  history.push({ role, text, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function clearConversation(phone) {
  conversations.delete(phone);
}

// ============================================================
// SYSTEM PROMPT - VERSIÓN CONCISA Y FLEXIBLE
// ============================================================

const SYSTEM_PROMPT = `Sos el asistente virtual de ${NOMBRE_HUMANO}. Tonada uruguaya natural: "tranqui", "buenazo", "de una", "impecable", "a las órdenes". NUNCA corporativo ni robótico.

REGLAS DE ORO:
1. RESPUESTAS CORTAS: máximo 2-3 oraciones cortas. Si el usuario escribe poco, vos también. NUNCA escribas párrafos largos.
2. MEMORIA: recordá lo que ya te dijo el usuario. NO repreguntar lo mismo.
3. NO seas insistente: si el usuario ya te dijo su ocupación o motivo, NO lo vuelvas a preguntar.
4. Flujo flexible: solo necesitás saber a qué se dedica y por qué escribió. Si ya lo sabés, pasá directo al link.
5. Si el usuario dice que quiere hablar con ${NOMBRE_HUMANO} o una persona real: respondé exactamente "¡De una! Le aviso ya mismo a ${NOMBRE_HUMANO} para que te escriba apenas se libere de la sesión. Aguantame un toque que apenas pueda se pone en contacto contigo." y dejá de hacer preguntas. Si vuelve a escribir, respondé "Ya le avisé a ${NOMBRE_HUMANO}, en breve se comunica contigo directamente."
6. Si el usuario rechaza o tiene apuro: "Tranqui, no te quito tiempo. Te dejo el link por si querés coordinar más adelante: ${LINK_CALCOM}. ¡Que tengas buen día!"
7. Si el usuario ya agendó o dijo que va a agendar: no insistas, solo "¡Impecable! Quedo atento por si necesitás algo más. Abrazo."

EJEMPLOS DE BUENAS RESPUESTAS:
- Usuario: "Hola" -> "¡Hola! ¿Qué tal? Lucas está en una sesión ahora, yo le coordino la agenda. ¿A qué te dedicás?"
- Usuario: "Soy diseñador" -> "¡Buenazo! ¿Y qué te motivó a escribirnos hoy?"
- Usuario: "Quiero mejorar mi marca personal" -> "Impecable, eso es justo lo que hace Lucas. Te paso el link para agendar una charla de 20 min: ${LINK_CALCOM}"
- Usuario: "ok" -> "¿Te animás a contarme a qué te dedicás? Así le paso el contexto a Lucas."
- Usuario: "ya te dije que soy abogado" -> "Perdón, tenés razón. Te paso el link: ${LINK_CALCOM}"
- Usuario: "dale pasame el link" -> "De una: ${LINK_CALCOM}"
- Usuario: "gracias" -> "¡A las órdenes! Cualquier cosa, acá estoy."`;

// ============================================================
// HANDLER PRINCIPAL
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      return handleWebhookVerification(req, res);
    }

    if (req.method === "POST") {
      return handleIncomingMessage(req, res);
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (error) {
    console.error("[ERROR] Handler principal:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

// ============================================================
// VERIFICACIÓN DE WEBHOOK (Meta)
// ============================================================

function handleWebhookVerification(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!mode || !token) {
    console.log("[WEBHOOK] GET ignorado (no es verificación de Meta).");
    return res.status(200).send("OK");
  }

  console.log("[WEBHOOK] Verificación recibida:", { mode, token });

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    console.log("[WEBHOOK] Verificación exitosa.");
    return res.status(200).send(challenge);
  }

  console.warn("[WEBHOOK] Verificación fallida. Token inválido.");
  return res.status(403).json({ error: "Verificación fallida" });
}

// ============================================================
// PROCESAMIENTO DE MENSAJES ENTRANTES
// ============================================================

async function handleIncomingMessage(req, res) {
  const body = req.body;

  if (body.object !== "whatsapp_business_account") {
    return res.status(404).json({ error: "No es un evento de WhatsApp" });
  }

  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];

    for (const change of changes) {
      const value = change.value || {};
      const messages = value.messages || [];

      for (const message of messages) {
        if (message.type === "text") {
          const from = message.from;
          const text = message.text?.body || "";

          console.log(`[MSG] De ${from}: "${text}"`);

          try {
            const reply = await getGeminiResponse(from, text);
            await sendWhatsAppMessage(from, reply);
          } catch (err) {
            console.error("[ERROR] Procesando mensaje:", err.message || err);
          }
        }
      }
    }
  }

  return res.status(200).json({ status: "ok" });
}

// ============================================================
// CONSULTA A GOOGLE GEMINI CON MEMORIA
// ============================================================

async function getGeminiResponse(phone, promptUsuario) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no está configurada");
  }

  addToConversation(phone, "user", promptUsuario);
  const history = getConversation(phone);
  
  const contents = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 800,    // ← VOLVIÓ A 800: límite generoso, brevedad por prompt
        topP: 0.9,
        topK: 40
      }
    })
  });

  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`API Falló con status ${response.status}: ${errorDetails}`);
  }

  const data = await response.json();

  const reply =
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Perdón, me quedé en blanco. ¿Me repetís eso?";

  addToConversation(phone, "model", reply.trim());

  console.log(`[GEMINI] Respuesta: "${reply.substring(0, 120)}..."`);

  return reply.trim();
}

// ============================================================
// ENVÍO DE MENSAJES DE WHATSAPP
// ============================================================

async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("Faltan credenciales de WhatsApp Business API");
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "text",
    text: { body: text }
  };

  const response = await fetch(WHATSAPP_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log(`[WHATSAPP] Mensaje enviado a ${to}:`, data.messages?.[0]?.id);

  return data;
}
