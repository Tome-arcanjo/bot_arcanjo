import "dotenv/config";
import crypto from "crypto";
import { getOrCreateSessionByPhone, processMessage } from "../services/chatService.js";
import { sendWhatsAppMessage, markMessageAsRead } from "../services/whatsappService.js";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

// Tipos de mensagem que ainda não sabemos processar — respondemos com uma
// mensagem amigável em vez de deixar o usuário sem resposta nenhuma.
const UNSUPPORTED_TYPE_LABEL = {
  image: "uma imagem",
  audio: "um áudio",
  video: "um vídeo",
  document: "um documento",
  sticker: "uma figurinha",
  location: "uma localização",
  contacts: "um contato",
  unknown: "esse tipo de conteúdo",
};

// GET /webhook/whatsapp - Verificação do webhook pela Meta
export function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("[WhatsApp] Webhook verificado com sucesso!");
    res.status(200).send(challenge);
  } else {
    console.warn("[WhatsApp] Falha na verificação do webhook (token não confere).");
    res.sendStatus(403);
  }
}

/**
 * Valida a assinatura X-Hub-Signature-256 enviada pela Meta em cada POST,
 * garantindo que o payload realmente veio da Meta e não foi forjado por
 * terceiros que descobriram a URL do webhook.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
function isValidSignature(req) {
  if (!APP_SECRET) {
    // Sem app secret configurado não há como validar — apenas avisa uma vez
    // por request. Configure WHATSAPP_APP_SECRET em produção.
    console.warn("[WhatsApp] WHATSAPP_APP_SECRET não configurado — pulando validação de assinatura.");
    return true;
  }

  const signatureHeader = req.get("x-hub-signature-256");
  if (!signatureHeader || !req.rawBody) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// POST /webhook/whatsapp - Recebimento de mensagens
export async function receiveMessage(req, res) {
  // Valida a origem da requisição ANTES de responder 200 e processar.
  if (!isValidSignature(req)) {
    console.warn("[WhatsApp] Assinatura inválida — payload rejeitado.");
    return res.sendStatus(401);
  }

  // Confirma recebimento rápido para a Meta (evita retries por timeout).
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value || !value.messages || value.messages.length === 0) continue;

        // Um único payload pode conter mais de uma mensagem — processa todas.
        for (const message of value.messages) {
          await handleIncomingMessage(message, value);
        }
      }
    }
  } catch (error) {
    console.error("[WhatsApp Webhook Error]", error);
  }
}

async function handleIncomingMessage(message, value) {
  const fromPhone = message.from; // Ex: 5511999999999
  const contact = (value.contacts || []).find((c) => c.wa_id === fromPhone) || value.contacts?.[0];
  const senderName = contact?.profile?.name || "Usuário";

  // Marca como lida em paralelo — não bloqueia o fluxo principal se falhar.
  markMessageAsRead(message.id).catch(() => {});

  let textContent;
  if (message.type === "text") {
    textContent = message.text.body;
  } else if (message.type === "interactive") {
    // Resposta de botão ou lista interativa
    textContent =
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      null;
  } else if (message.type === "button") {
    textContent = message.button?.text || null;
  }

  if (!textContent) {
    const label = UNSUPPORTED_TYPE_LABEL[message.type] || UNSUPPORTED_TYPE_LABEL.unknown;
    console.log(`[WhatsApp] Recebido de ${fromPhone}: mensagem do tipo "${message.type}" (não suportada)`);
    await safeSend(fromPhone, `No momento eu ainda não consigo processar ${label} 🙏 — pode me enviar como texto?`);
    return;
  }

  console.log(`[WhatsApp] Recebido de ${fromPhone} (${senderName}): ${textContent}`);

  try {
    // 1. Obtém ou cria a sessão vinculada ao telefone
    const session = await getOrCreateSessionByPhone(fromPhone);

    // 2. Processa a mensagem usando o ChatService (IA + histórico)
    //    Usa o provider padrão da sessão
    const aiResponse = await processMessage(session.id, textContent, session.provider);

    // 3. Envia a resposta de volta ao WhatsApp
    await sendWhatsAppMessage(fromPhone, aiResponse.content);
    console.log(`[WhatsApp] Respondido para ${fromPhone}`);
  } catch (error) {
    // Sem isso, um erro na IA ou no banco deixava o usuário sem resposta e
    // sem nenhum feedback — o request nem sabe que algo deu errado.
    console.error(`[WhatsApp] Erro ao processar mensagem de ${fromPhone}:`, error.message);
    await safeSend(
      fromPhone,
      "Desculpa, tive um problema para processar sua mensagem agora 😕 Pode tentar de novo em instantes?"
    );
  }
}

async function safeSend(to, text) {
  try {
    await sendWhatsAppMessage(to, text);
  } catch (error) {
    console.error(`[WhatsApp] Falha ao enviar mensagem de fallback para ${to}:`, error.message);
  }
}
