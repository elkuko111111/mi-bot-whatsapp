const express = require('express');
const axios = require('axios');
const app = express();

// Permite que Express lea los datos JSON que envía Meta
app.use(express.json());

// Tus variables de entorno (configuradas en Render)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
// ¡IMPORTANTE! Necesitas el ID de tu número de teléfono de Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; 

// 1. RUTA GET: Para la verificación inicial de Meta
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('¡Webhook verificado por Meta!');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// 2. RUTA POST: Para recibir mensajes y responder
app.post('/webhook', async (req, res) => {
    // Imprime todo lo que llega en los Logs de Render
    console.log("📨 ¡Llegó un webhook de Meta!");
    console.log(JSON.stringify(req.body, null, 2));

    try {
        // Navegamos por la estructura del mensaje de Meta
        const body = req.body;
        
        // Verificamos si el webhook trae un mensaje de texto real
        if (
            body.entry && 
            body.entry[0].changes && 
            body.entry[0].changes[0].value.messages && 
            body.entry[0].changes[0].value.messages[0]
        ) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from; // El número de quien te escribe
            
            // Solo respondemos si es un mensaje de texto
            if (message.type === 'text') {
                const msg_body = message.text.body;
                console.log(`🗣️ Mensaje recibido de ${from}: ${msg_body}`);

                // Enviamos la respuesta automática vía Axios
                await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        messaging_product: 'whatsapp',
                        to: from,
                        text: { body: "¡Hola! Soy tu bot. Recibí tu mensaje: " + msg_body }
                    }
                });
                
                console.log("✅ Respuesta enviada con éxito.");
            }
        }
        // Siempre hay que responderle a Meta con un 200 OK para que sepa que lo recibimos
        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error al procesar el mensaje:", error.response ? error.response.data : error.message);
        res.sendStatus(200); // Igual enviamos 200 para que Meta no reintente infinitamente
    }
});

// Iniciamos el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
