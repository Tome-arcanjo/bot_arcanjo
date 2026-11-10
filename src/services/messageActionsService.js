import { getDb } from "../database/db.js";
import eventBus from "../utils/events.js";
import { getSessionById } from "./chatService.js";
import { getWindowState, WINDOW_CLOSED_ERROR } from "./outboundService.js";
import { sendHumanMessage } from "./handoverService.js";
import { sendWhatsAppReaction } from "./whatsappService.js";

/**
 * Ações sobre mensagens já gravadas: reagir, editar, apagar, encaminhar.
 *
 * Limites da Cloud API (não há como contornar):
 *  - não existe editar nem apagar uma mensagem já entregue ao cliente. Aqui,
 *    "editar" manda uma CORREÇÃO respondendo à mensagem original (que fica
 *    marcada como editada), e "apagar" esconde a mensagem só no painel;
 *  - reação é uma por lado: uma do cliente e uma da empresa (a equipe toda
 *    divide o mesmo número).
 * Toda alteração emite "messageUpdated" (SSE "update" em /api/conversas/stream).
 */

export class MessageActionError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const MAX_EMOJI_LENGTH = 16; // um emoji com modificadores (pele, ZWJ) cabe folgado

async function loadMessage(messageId) {
  const { data, error } = await getDb().from("messages").select("*").eq("id", messageId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new MessageActionError("Mensagem não encontrada.", 404);
  return data;
}

async function updateMessage(message, fields) {
  const { data, error } = await getDb().from("messages").update(fields).eq("id", message.id).select().single();
  if (error) throw new Error(error.message);
  eventBus.emit("messageUpdated", { message: data, sessionId: data.session_id });
  return data;
}

/** Troca (ou tira, com emoji vazio) a reação de um lado. */
function withReaction(reactions, from, emoji, name) {
  const others = (Array.isArray(reactions) ? reactions : []).filter((r) => r.from !== from);
  return emoji ? [...others, { from, emoji, name: name || null, at: new Date().toISOString() }] : others;
}

const isAuthorOrAdmin = (message, user) => user?.role === "admin" || (message.sender_user_id || null) === (user?.id || null);

/** A equipe reage a uma mensagem (do cliente ou nossa). Vale na janela de 24 h. */
export async function reactToMessage(messageId, emoji, user) {
  const clean = typeof emoji === "string" ? emoji.trim() : "";
  if (clean.length > MAX_EMOJI_LENGTH) throw new MessageActionError("Reação inválida.");
  const message = await loadMessage(messageId);
  if (message.deleted_at) throw new MessageActionError("Mensagem apagada.", 409);
  if (!message.wa_message_id) throw new MessageActionError("Só dá para reagir a mensagens que passaram pelo WhatsApp.", 409);

  const session = await getSessionById(message.session_id);
  if (!session?.phone) throw new MessageActionError("Conversa sem WhatsApp.", 409);
  if (!(await getWindowState(session.id)).open) {
    throw new MessageActionError(WINDOW_CLOSED_ERROR, 409, { code: "WINDOW_CLOSED" });
  }
  const result = await sendWhatsAppReaction(session.phone, message.wa_message_id, clean);
  if (!result.ok) throw new MessageActionError(result.error || "Não foi possível reagir.", 502);
  return updateMessage(message, { reactions: withReaction(message.reactions, "team", clean, user?.name) });
}

/** Reação que o cliente mandou pelo WhatsApp (webhook, type "reaction"). */
export async function applyClientReaction(waMessageId, emoji, name) {
  if (!waMessageId) return null;
  const { data } = await getDb().from("messages").select("*").eq("wa_message_id", waMessageId).limit(1);
  const message = data?.[0];
  if (!message) return null;
  return updateMessage(message, { reactions: withReaction(message.reactions, "client", emoji || "", name) });
}

/**
 * Edita uma mensagem de texto escrita por mim (ou qualquer uma, se admin).
 *  - não chegou ao cliente (falhou): troca o texto; dá para reenviar depois;
 *  - já foi enviada: manda "Correção: ..." respondendo à original.
 */
export async function editMessage(messageId, content, user) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new MessageActionError("Escreva o novo texto.");
  const message = await loadMessage(messageId);
  if (message.role !== "human" || message.message_type !== "text" || message.deleted_at) {
    throw new MessageActionError("Só dá para editar mensagens de texto da equipe.", 409);
  }
  if (!isAuthorOrAdmin(message, user)) throw new MessageActionError("Só quem escreveu (ou um admin) pode editar.", 403);
  if (text === message.content) return { original: message, correction: null };

  if (message.delivery_status === "failed") {
    return { original: await updateMessage(message, { content: text, edited_at: new Date().toISOString() }), correction: null };
  }
  // Sem force: se outra pessoa assumiu a conversa, a correção não passa por cima.
  const { message: correction, ok } = await sendHumanMessage(message.session_id, user, `*Correção:* ${text}`, {
    replyToId: message.id,
  });
  const original = await updateMessage(message, { edited_at: new Date().toISOString() });
  return { original, correction, delivered: ok };
}

/** "Apaga" uma mensagem da equipe — só no painel; o cliente continua com ela. */
export async function deleteMessage(messageId, user) {
  const message = await loadMessage(messageId);
  if (message.role !== "human") throw new MessageActionError("Só dá para apagar mensagens enviadas pela equipe.", 409);
  if (!isAuthorOrAdmin(message, user)) throw new MessageActionError("Só quem escreveu (ou um admin) pode apagar.", 403);
  if (message.deleted_at) return message;
  return updateMessage(message, { deleted_at: new Date().toISOString(), deleted_by_name: user?.name || null });
}

/**
 * Encaminha uma mensagem (texto ou anexo) para outras conversas. Cada destino
 * segue as regras de responder: assume a conversa, respeita a janela de 24 h
 * e não passa por cima de quem está atendendo.
 * @returns {Promise<Array<{ sessionId, ok, error?, code?, message? }>>}
 */
export async function forwardMessage(messageId, sessionIds, user) {
  const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean))].slice(0, 20);
  if (ids.length === 0) throw new MessageActionError("Escolha para quem encaminhar.");
  const message = await loadMessage(messageId);
  if (message.deleted_at || message.message_type === "template") throw new MessageActionError("Esta mensagem não pode ser encaminhada.", 409);
  if (message.media && !message.media.path) throw new MessageActionError("O anexo desta mensagem não está no servidor.", 409);

  const media = message.media ? { ...message.media, waId: null } : null;
  const content = media ? message.media.caption || "" : message.content;
  const results = [];
  for (const sessionId of ids) {
    try {
      const { message: sent, ok } = await sendHumanMessage(sessionId, user, content, {
        type: message.message_type,
        media,
        forwarded: true,
      });
      results.push({ sessionId, ok, message: sent, error: ok ? null : sent.delivery_error });
    } catch (error) {
      results.push({ sessionId, ok: false, error: error.message, code: error.code || null });
    }
  }
  return results;
}

/** Figurinhas já usadas nas conversas (enviadas ou recebidas), sem repetir. */
export async function listStickers(limit = 48) {
  const { data, error } = await getDb()
    .from("messages")
    .select("id, media, deleted_at, created_at")
    .eq("message_type", "sticker")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const seen = new Set();
  const stickers = [];
  for (const m of data || []) {
    if (m.deleted_at || !m.media?.path || seen.has(m.media.sha256 || m.id)) continue;
    seen.add(m.media.sha256 || m.id);
    stickers.push({ messageId: m.id });
    if (stickers.length >= limit) break;
  }
  return stickers;
}

/** Envia de novo uma figurinha já guardada (escolhida no painel de figurinhas). */
export async function sendSavedSticker(sessionId, stickerMessageId, user, { force = false, replyToId = null } = {}) {
  const source = await loadMessage(stickerMessageId);
  if (source.message_type !== "sticker" || !source.media?.path) throw new MessageActionError("Figurinha não encontrada.", 404);
  return sendHumanMessage(sessionId, user, "", { type: "sticker", media: { ...source.media, waId: null, caption: null }, force, replyToId });
}
