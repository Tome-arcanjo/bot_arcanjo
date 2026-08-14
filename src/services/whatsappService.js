import "dotenv/config";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Envia uma mensagem de texto via WhatsApp Cloud API
 * @param {string} to - Número de telefone do destinatário (com código do país)
 * @param {string} text - Texto da mensagem
 */
export async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("[WhatsApp] Tokens não configurados. Mensagem não enviada:", text);
    return;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Erro API WhatsApp: ${JSON.stringify(data)}`);
    }
    
    return data;
  } catch (error) {
    console.error("[WhatsApp Error]", error.message);
  }
}
