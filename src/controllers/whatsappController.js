import "dotenv/config";
import crypto from "crypto";
import {
  getOrCreateSessionByPhone,
  getSessionById,
  getMessageByWaId,
  saveIncomingMessage,
  generateAiReply,
} from "../services/chatService.js";
import { markMessageAsRead, describeMetaError, downloadWhatsAppMedia } from "../services/whatsappService.js";
import { saveMedia } from "../services/mediaService.js";
import { applyClientReaction } from "../services/messageActionsService.js";
import { deliverMessage, applyDeliveryStatus } from "../services/outboundService.js";
import { syncIncomingContact } from "../services/atendimentoService.js";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

// Tipos que não são texto. Anexos ficam guardados para a equipe ver no painel;
// a IA só lê texto, então (com ela ativa) pede o conteúdo por escrito.
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
  // Sem app secret não há como provar que o payload veio da Meta — recusa em
  // vez de aceitar qualquer POST de quem descobrir a URL do webhook.
  if (!APP_SECRET) {
    console.error("[WhatsApp] WHATSAPP_APP_SECRET não configurado — payload recusado. Configure-o no .env.");
    return res.sendStatus(503);
  }

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
        if (!value) continue;

        // Avisos de entrega das mensagens que NÓS enviamos (sent/delivered/
        // read/failed). A falha da janela de 24 h só chega por aqui.
        for (const status of value.statuses || []) {
          const error = status.errors?.[0] ? describeMetaError(status.errors[0]) : null;
          await applyDeliveryStatus(status.id, status.status, error);
        }

        // Um único payload pode conter mais de uma mensagem — processa todas.
        for (const message of value.messages || []) {
          await handleIncomingMessage(message, value);
        }
      }
    }
  } catch (error) {
    console.error("[WhatsApp Webhook Error]", error);
  }
}

const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

/** Baixa o anexo da Meta e guarda no disco. Se falhar, fica a descrição com o erro. */
async function fetchIncomingMedia(type, object = {}) {
  const base = { mime: object.mime_type || null, name: object.filename || null, caption: object.caption || null, waId: object.id || null };
  if (!object.id) return { ...base, error: "A Meta não informou o anexo." };
  const download = await downloadWhatsAppMedia(object.id);
  if (!download.ok) {
    console.warn(`[WhatsApp] Não foi possível baixar ${type} ${object.id}: ${download.error}`);
    return { ...base, error: download.error };
  }
  return saveMedia(download.buffer, { mime: download.mime || base.mime, name: base.name, caption: base.caption, waId: object.id });
}

/**
 * Traduz a mensagem da Meta para o que gravamos: { type, content, media,
 * classify, autoReply }. content é o que a IA lê (texto, ou um aviso como
 * "[O cliente enviou uma imagem]: legenda").
 */
async function parseIncoming(message) {
  const text =
    message.type === "text" ? message.text?.body
    : message.type === "interactive" ? message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
    : message.type === "button" ? message.button?.text
    : null;
  if (text) return { type: "text", content: text, media: null, classify: true };

  const label = UNSUPPORTED_TYPE_LABEL[message.type] || UNSUPPORTED_TYPE_LABEL.unknown;
  if (MEDIA_TYPES.has(message.type)) {
    const object = message[message.type];
    const media = object ? await fetchIncomingMedia(message.type, object) : null;
    const caption = object?.caption ? `: ${object.caption}` : "";
    return {
      type: message.type,
      content: `[O cliente enviou ${label}]${caption}`,
      media,
      classify: false,
      // Figurinha não precisa de explicação: a IA responde normalmente.
      autoReply: message.type === "sticker"
        ? null
        : `Recebi ${label} e já deixei registrado para a nossa equipe 👍 Como sou um assistente virtual, ainda não consigo processar ${label} — pode me contar por escrito?`,
    };
  }
  return {
    type: message.type === "location" || message.type === "contacts" ? message.type : "unsupported",
    content: `[O cliente enviou ${label} — tipo ainda não suportado pelo bot]`,
    media: null,
    classify: false,
    autoReply: `No momento eu ainda não consigo processar ${label} 🙏 — pode me enviar como texto?`,
  };
}

async function handleIncomingMessage(message, value) {
  const fromPhone = message.from; // Ex: 5511999999999
  const contact = (value.contacts || []).find((c) => c.wa_id === fromPhone) || value.contacts?.[0];
  const profileName = contact?.profile?.name || null; // nome do perfil do WhatsApp (a Cloud API não manda foto)
  const senderName = profileName || "Usuário";

  // Reação do cliente a uma mensagem: só atualiza a mensagem, sem resposta.
  if (message.type === "reaction") {
    await applyClientReaction(message.reaction?.message_id, message.reaction?.emoji, profileName).catch((e) =>
      console.error(`[WhatsApp] Erro ao aplicar reação de ${fromPhone}:`, e.message)
    );
    return;
  }

  // A Meta reenvia o webhook quando não recebe 200 a tempo: não duplica.
  if (message.id && (await getMessageByWaId(message.id))) return;

  // Marca como lida em paralelo — não bloqueia o fluxo principal se falhar.
  markMessageAsRead(message.id).catch(() => {});

  try {
    // 1. Obtém ou cria a sessão vinculada ao telefone e guarda o nome do
    //    WhatsApp (e reabre no quadro de Atendimento quem estava finalizado).
    let session = await getOrCreateSessionByPhone(fromPhone);
    session = await syncIncomingContact(session, profileName);

    // 2. Salva a mensagem do cliente (sempre — com IA ativa ou pausada) e
    //    dispara a classificação do CRM. Tipos não suportados ficam
    //    registrados como aviso, para a equipe ver que o cliente mandou algo.
    const incoming = await parseIncoming(message);
    let autoReply = incoming.autoReply || null;
    console.log(`[WhatsApp] Recebido de ${fromPhone} (${senderName}) [${incoming.type}]: ${incoming.content}`);
    const replyTo = message.context?.id ? await getMessageByWaId(message.context.id) : null;
    await saveIncomingMessage(session, incoming.content, {
      classify: incoming.classify,
      type: incoming.type,
      media: incoming.media,
      waMessageId: message.id || null,
      replyToId: replyTo?.session_id === session.id ? replyTo.id : null,
    });

    // 3. Atendimento humano: a IA não responde essa conversa.
    if (session.ai_paused) {
      console.log(`[WhatsApp] IA pausada para ${fromPhone} (atendimento humano) — mensagem salva, sem resposta automática.`);
      return;
    }

    // 4. Gera a resposta da IA (sem enviar ainda)
    if (!autoReply) {
      try {
        autoReply = await generateAiReply(session);
      } catch (error) {
        // Sem isso, um erro na IA deixava o usuário sem resposta e sem
        // nenhum feedback — o request nem sabe que algo deu errado.
        console.error(`[WhatsApp] Erro da IA ao responder ${fromPhone}:`, error.message);
        autoReply = "Desculpa, tive um problema para processar sua mensagem agora 😕 Pode tentar de novo em instantes?";
      }
    }

    // 5. Alguém pode ter assumido a conversa enquanto a IA pensava.
    const current = (await getSessionById(session.id)) || session;
    if (current.ai_paused) {
      console.log(`[WhatsApp] ${fromPhone} foi assumido por um atendente enquanto a IA respondia — resposta da IA descartada.`);
      return;
    }

    // 6. Envia (a mensagem fica gravada com o status da entrega)
    const { ok } = await deliverMessage({ session: current, content: autoReply, role: "assistant" });
    if (ok) console.log(`[WhatsApp] Respondido para ${fromPhone}`);
  } catch (error) {
    console.error(`[WhatsApp] Erro ao processar mensagem de ${fromPhone}:`, error.message);
  }
}
