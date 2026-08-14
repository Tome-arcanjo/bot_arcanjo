import "dotenv/config";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
// v17.0 foi descontinuada pela Meta em 12/09/2025 — mantenha esta versão
// atualizada periodicamente (ver https://developers.facebook.com/docs/graph-api/changelog).
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}`;

/**
 * Envia uma mensagem de texto via WhatsApp Cloud API
 * @param {string} to - Número de telefone do destinatário (com código do país, sem "+")
 * @param {string} text - Texto da mensagem
 */
export async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn("[WhatsApp] Tokens não configurados. Mensagem não enviada:", text);
    return;
  }

  try {
    const response = await fetch(`${GRAPH_BASE_URL}/messages`, {
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
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Erro API WhatsApp: ${JSON.stringify(data)}`);
    }

    return data;
  } catch (error) {
    console.error("[WhatsApp Error]", error.message);
    throw error;
  }
}

/**
 * Marca uma mensagem recebida como lida (mostra o "✓✓" azul para o usuário).
 * Falha silenciosamente — é apenas cosmético e não deve derrubar o fluxo principal.
 * @param {string} messageId - id da mensagem recebida (value.messages[i].id)
 */
export async function markMessageAsRead(messageId) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !messageId) return;

  try {
    const response = await fetch(`${GRAPH_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn("[WhatsApp] Falha ao marcar como lida:", JSON.stringify(data));
    }
  } catch (error) {
    console.warn("[WhatsApp] Falha ao marcar como lida:", error.message);
  }
}
