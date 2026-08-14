import "dotenv/config";
import { getOrCreateSessionByPhone, processMessage } from "../services/chatService.js";
import { sendWhatsAppMessage } from "../services/whatsappService.js";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// GET /webhook/whatsapp - Verificação do webhook pela Meta
export function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WhatsApp] Webhook verificado com sucesso!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

// POST /webhook/whatsapp - Recebimento de mensagens
export async function receiveMessage(req, res) {
  try {
    const body = req.body;

    // Confirma recebimento rápido para a Meta (evita retries)
    res.sendStatus(200);

    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry) {
      const changes = entry.changes;
      for (const change of changes) {
        const value = change.value;
        if (value.messages && value.messages.length > 0) {
          const message = value.messages[0];
          const contact = value.contacts && value.contacts[0];

          if (message.type === "text") {
            const fromPhone = message.from; // Ex: 5511999999999
            const textContent = message.text.body;
            const senderName = contact ? contact.profile.name : "Usuário";

            console.log(`[WhatsApp] Recebido de ${fromPhone} (${senderName}): ${textContent}`);

            // 1. Obtém ou cria a sessão vinculada ao telefone
            const session = await getOrCreateSessionByPhone(fromPhone);

            // 2. Processa a mensagem usando o ChatService (OpenAI, histórico, etc)
            // Usa o provider padrão da sessão
            const aiResponse = await processMessage(session.id, textContent, session.provider);

            // 3. Envia a resposta de volta ao WhatsApp
            await sendWhatsAppMessage(fromPhone, aiResponse.content);
            console.log(`[WhatsApp] Respondido para ${fromPhone}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("[WhatsApp Webhook Error]", error);
  }
}
