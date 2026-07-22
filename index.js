const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// Configuraciones (Render nos permitirá ocultar estos datos por seguridad)
const PORT = process.env.PORT || 3000;
const TOKEN_META = process.env.WHATSAPP_TOKEN; // Tu Token Temporal
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Una contraseña inventada por ti (ej. "MiBotSecreto123")

// 1. ENDPOINT DE VERIFICACIÓN (El que Meta usa para conectar)
app.get("/webhook", (req, res) => {
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("¡Webhook verificado correctamente por Meta!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 2. ENDPOINT PARA RECIBIR MENSAJES
app.post("/webhook", async (req, res) => {
  let body = req.body;

  // Meta exige que siempre respondamos 200 OK rápido para no bloquear el webhook
  res.sendStatus(200);

  if (body.object) {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
      
      let phone_number_id = body.entry[0].changes[0].value.metadata.phone_number_id;
      let from = body.entry[0].changes[0].value.messages[0].from; // El número de quien te escribe
      let msg_body = body.entry[0].changes[0].value.messages[0].text.body; // El texto que te enviaron

      console.log(`Mensaje recibido de ${from}: ${msg_body}`);

      // 3. RESPONDER EL MENSAJE
      try {
        await axios({
          method: "POST",
          url: `https://graph.facebook.com/v20.0/${phone_number_id}/messages`,
          data: {
            messaging_product: "whatsapp",
            to: from,
            text: { body: `¡Hola! Soy tu bot automático. Recibí tu mensaje: "${msg_body}"` }
          },
          headers: {
            "Authorization": `Bearer ${TOKEN_META}`,
            "Content-Type": "application/json"
          }
        });
      } catch (error) {
        console.error("Error al enviar mensaje:", error.response ? error.response.data : error);
      }
    }
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de WhatsApp Bot escuchando en el puerto ${PORT}`);
});