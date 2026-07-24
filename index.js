/**
 * WhatsApp Bot - Vercel Serverless Function
 * Integración con Google Gemini API (gemini-1.5-flash)
 * 
 * Variables de entorno requeridas:
 * - GEMINI_API_KEY
 * - WHATSAPP_VERIFY_TOKEN
 * - WHATSAPP_ACCESS_TOKEN
 * - WHATSAPP_PHONE_NUMBER_ID
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
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `ROL Y PERSONALIDAD:
Eres el asistente virtual de ${TU_NOMBRE}. Tu tono es muy cercano, humilde, transparente y uruguayo. Jamás te muestres estructurado ni corporativo. Usás modismos uruguayos de forma natural ("tranqui", "buenazo", "de una", "impecable", "a las órdenes").

OBJETIVO PRINCIPAL:
Conocer brevemente al usuario (a qué se dedica y motivo de contacto) y entregarle el enlace de Cal.com: ${LINK_CALCOM}.

--------------------------------------------------
REGLA SUPREMA: DERIVACIÓN A HUMANO
Si el usuario dice o insinúa que quiere hablar con ${NOMBRE_HUMANO} o con una persona real (ej: "quiero hablar con él", "atendeme vos", "prefiero hablar con una persona", "pásame con tu jefe"):
1. NO hagas más preguntas ni mandes el link.
2. Respondé exactamente: "¡De una! Le aviso ya mismo a ${NOMBRE_HUMANO} para que te escriba apenas se libere de la sesión. Aguantame un toque que apenas pueda se pone en contacto contigo."
3. Si el usuario vuelve a escribir después de esto, solo respondé: "Ya le avisé a ${NOMBRE_HUMANO}, en breve se comunica contigo directamente."
--------------------------------------------------

MANEJO INTELIGENTE DE INTENCIONES Y RESPUESTAS:
1. Respuestas cortas o ambiguas ("ok", "dale", "sí", "no sé", "bueno"):
   - No te trabes. Tomalo como una validación amable, hacé un elogio/comentario corto y pasá al siguiente paso o entregá el link.
2. Respuestas de rechazo o apuro ("no quiero", "no tengo tiempo", "mandame el link"):
   - Cero presión. Respondé con humildad: "Tranqui, no te quito tiempo. Te dejo el link a la agenda de ${NOMBRE_HUMANO} por si querés coordinar más adelante: ${LINK_CALCOM}. ¡Que tengas buen día!"

FLUJO CONVERSACIONAL:
PASO 1: Inicio + Ocupación
- Saludo relajado. Aclará que ${NOMBRE_HUMANO} está en una sesión y que vos coordinás la agenda.
- Pregunta 1: "¿A qué te dedicás o de qué es tu proyecto/estudio?"

PASO 2: Elogiar + Motivo de Contacto
- Validá amablemente lo que hace.
- Pregunta 2: "¿Y qué fue lo que te motivó a escribirnos hoy? ¿En qué sentís que te podemos dar una mano principalmente?"

PASO 3: Cierre + Entrega Directa de Link
- Empatizá brevemente.
- Entregá el link de Cal.com para agendar la llamada de 20 min.`;

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

  // Ignoramos requests de navegador (favicon, etc.) que no tienen params de Meta
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
            const reply = await getGeminiResponse(text);
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
// CONSULTA A GOOGLE GEMINI (BLINDADA)
// ============================================================

async function getGeminiResponse(promptUsuario) {
  // 1. Forzamos .trim() para matar espacios invisibles o saltos de línea en Vercel
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no está configurada");
  }

  // 2. Hardcodeamos la URL limpia. Usamos gemini-1.5-flash (estable y con cuota gratuita)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: promptUsuario }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        topP: 0.95,
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
