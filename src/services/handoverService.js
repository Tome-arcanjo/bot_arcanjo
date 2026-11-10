import { getDb } from "../database/db.js";
import eventBus from "../utils/events.js";
import { getSessionById } from "./chatService.js";
import { getCaseByPhone } from "./crmService.js";
import { recordCaseEvent, actorOf } from "./caseEventsService.js";
import { deliverMessage, getWindowState, sendReengageTemplate } from "./outboundService.js";
import { getUserById } from "./usersService.js";
import { FINISHED_STAGE, stageFields, stageFieldsOnHandle } from "../constants/atendimento.js";
import { mediaLabel } from "./mediaService.js";

/**
 * Atendimento humano nas conversas.
 *
 * "Assumir" pausa a IA naquela conversa (sessions.ai_paused) e define quem
 * está atendendo (handler_user_id). Enquanto pausada, o webhook continua
 * salvando e classificando as mensagens do cliente, mas a IA não responde.
 * "Devolver à IA" desfaz e devolve o cliente à fila de "Atendimento pendente"
 * (sessions.queue_since). Enviar uma mensagem como humano assume a conversa
 * automaticamente. "Transferir" passa a conversa para outra pessoa e
 * "Encerrar" finaliza o atendimento (coluna Finalizado do quadro; a IA volta
 * a responder se o cliente escrever de novo).
 *
 * Para dois funcionários não responderem o mesmo cliente ao mesmo tempo:
 *  - responder/assumir uma conversa que outra pessoa está atendendo exige
 *    confirmação (force) — a API devolve 409 HANDLED_BY_OTHER com o nome;
 *  - presença em memória mostra quem está com a conversa aberta agora.
 */

export class HandoverError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const MAX_MESSAGE_LENGTH = 4096; // limite de texto da Cloud API

async function loadSession(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) throw new HandoverError("Conversa não encontrada.", 404);
  return session;
}

async function userName(userId) {
  if (!userId) return null;
  const { data } = await getDb().from("users").select("name").eq("id", userId).maybeSingle();
  return data?.name || "outra pessoa";
}

function sameUser(handlerId, user) {
  return (handlerId || null) === (user?.id || null);
}

async function recordHandoverEvent(session, actor, type, from = null, to = null) {
  let caseId = null;
  if (session.phone) {
    try {
      caseId = (await getCaseByPhone(session.phone))?.id || null;
    } catch {
      // sem caso no CRM: o evento fica só com a conversa
    }
  }
  await recordCaseEvent({ caseId, sessionId: session.id, actor, type, from, to });
}

async function updateSession(sessionId, fields, actor) {
  const { data, error } = await getDb().from("sessions").update(fields).eq("id", sessionId).select().single();
  if (error) {
    console.error(`[Atendimento] Erro ao atualizar a conversa ${sessionId}:`, error.message);
    throw new HandoverError("Não foi possível atualizar a conversa. Confira se a migração do banco foi aplicada.", 500);
  }
  eventBus.emit("sessionUpdated", { session: data, actor: actorOf(actor) });
  return data;
}

async function ensureNotHandledByOther(session, user, force) {
  if (session.ai_paused && session.handler_user_id && !sameUser(session.handler_user_id, user) && !force) {
    const name = await userName(session.handler_user_id);
    throw new HandoverError(`${name} está atendendo esta conversa.`, 409, {
      code: "HANDLED_BY_OTHER",
      handler: { id: session.handler_user_id, name },
    });
  }
}

/** Assume a conversa: pausa a IA e passa a ser o responsável. */
export async function assumeSession(sessionId, user, { force = false } = {}) {
  const session = await loadSession(sessionId);
  await ensureNotHandledByOther(session, user, force);
  if (session.ai_paused && sameUser(session.handler_user_id, user)) return session;

  const previous = session.ai_paused ? await userName(session.handler_user_id) : null;
  const updated = await updateSession(
    sessionId,
    {
      ai_paused: true,
      ai_paused_at: new Date().toISOString(),
      handler_user_id: user?.id || null,
      queue_since: null,
      ...stageFieldsOnHandle(session, user),
    },
    user
  );
  await recordHandoverEvent(updated, user, "ai_paused", previous, user?.name || null);
  console.log(`[Atendimento] ${user?.name} assumiu a conversa ${session.phone || sessionId}${previous ? ` (antes: ${previous})` : ""}.`);
  return updated;
}

/** Devolve a conversa para a IA responder. */
export async function releaseSession(sessionId, user) {
  const session = await loadSession(sessionId);
  if (!session.ai_paused) return session;

  const previous = await userName(session.handler_user_id);
  const updated = await updateSession(
    sessionId,
    { ai_paused: false, ai_paused_at: null, handler_user_id: null, queue_since: new Date().toISOString() },
    user
  );
  await recordHandoverEvent(updated, user, "ai_resumed", previous, null);
  console.log(`[Atendimento] ${user?.name} devolveu a conversa ${session.phone || sessionId} à IA.`);
  return updated;
}

/** Transfere a conversa para outra pessoa da equipe (a IA fica pausada). */
export async function transferSession(sessionId, toUserId, user, { force = false } = {}) {
  const target = toUserId ? await getUserById(toUserId) : null;
  if (!target || !target.active) throw new HandoverError("Escolha uma pessoa ativa da equipe.");
  const session = await loadSession(sessionId);
  await ensureNotHandledByOther(session, user, force);
  if (session.ai_paused && session.handler_user_id === target.id) return session;

  const previous = session.ai_paused ? await userName(session.handler_user_id) : null;
  const updated = await updateSession(
    sessionId,
    {
      ai_paused: true,
      ai_paused_at: new Date().toISOString(),
      handler_user_id: target.id,
      queue_since: null,
      ...stageFieldsOnHandle(session, user),
    },
    user
  );
  await recordHandoverEvent(updated, user, "ai_paused", previous, target.name);
  console.log(`[Atendimento] ${user?.name} transferiu a conversa ${session.phone || sessionId} para ${target.name}.`);
  return updated;
}

/**
 * Encerra o atendimento: coluna "Finalizado", sem responsável e fora da fila.
 * Se o cliente escrever de novo, volta para a fila (atendimentoService).
 */
export async function closeSession(sessionId, user, { force = false } = {}) {
  const session = await loadSession(sessionId);
  await ensureNotHandledByOther(session, user, force);
  if (session.board_stage === FINISHED_STAGE && !session.ai_paused && !session.queue_since) return session;

  const previous = session.ai_paused ? await userName(session.handler_user_id) : null;
  const updated = await updateSession(
    sessionId,
    { ai_paused: false, ai_paused_at: null, handler_user_id: null, queue_since: null, ...stageFields(FINISHED_STAGE, user) },
    user
  );
  await recordHandoverEvent(updated, user, "ai_resumed", previous, "Atendimento encerrado");
  console.log(`[Atendimento] ${user?.name} encerrou o atendimento de ${session.phone || sessionId}.`);
  return updated;
}

async function loadReplyTarget(sessionId, replyToId) {
  if (!replyToId) return null;
  const { data } = await getDb().from("messages").select("id, session_id, deleted_at").eq("id", replyToId).maybeSingle();
  if (!data || data.session_id !== sessionId || data.deleted_at) throw new HandoverError("A mensagem citada não existe mais nesta conversa.");
  return data.id;
}

/**
 * Funcionário responde pelo painel (texto ou anexo). Pausa a IA
 * automaticamente (assume). Fora da janela de 24 h recusa com 409
 * WINDOW_CLOSED (o painel oferece o modelo de retomada) em vez de gravar uma
 * mensagem que a Meta vai recusar.
 *
 * @param {string} content - texto (para anexo, a legenda; pode ser vazio)
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - responder mesmo com outra pessoa atendendo
 * @param {string} [opts.replyToId] - mensagem citada (mesma conversa)
 * @param {string} [opts.type] - tipo do anexo (mediaService.prepareUpload)
 * @param {Object} [opts.media] - anexo já guardado (mediaService.saveMedia)
 * @param {boolean} [opts.forwarded]
 */
export async function sendHumanMessage(sessionId, user, content, { force = false, replyToId = null, type = "text", media = null, forwarded = false } = {}) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text && !media) throw new HandoverError("Escreva a mensagem antes de enviar.");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new HandoverError(`Mensagem longa demais (máximo de ${MAX_MESSAGE_LENGTH} caracteres).`);
  }

  let session = await loadSession(sessionId);
  if (!session.phone) throw new HandoverError("Esta conversa não tem telefone de WhatsApp.");
  await ensureNotHandledByOther(session, user, force);

  const windowState = await getWindowState(sessionId);
  if (!windowState.open) {
    throw new HandoverError(
      "Fora da janela de 24 h: o WhatsApp só aceita um modelo aprovado para retomar a conversa.",
      409,
      { code: "WINDOW_CLOSED", window: windowState }
    );
  }

  const reply = await loadReplyTarget(sessionId, replyToId);
  if (!session.ai_paused || !sameUser(session.handler_user_id, user)) {
    session = await assumeSession(sessionId, user, { force: true });
  }
  return deliverMessage({
    session,
    // Para a IA e as prévias, um anexo sem legenda vira "[Imagem]", "[Áudio]"...
    content: text || `[${mediaLabel(type)}]`,
    role: "human",
    sender: user,
    type: media ? type : "text",
    media: media ? { ...media, caption: text || null } : null,
    replyToId: reply,
    forwarded,
  });
}

/** Envia o modelo de retomada (vale fora da janela de 24 h). Também assume a conversa. */
export async function sendTemplateMessage(sessionId, user, { force = false } = {}) {
  let session = await loadSession(sessionId);
  if (!session.phone) throw new HandoverError("Esta conversa não tem telefone de WhatsApp.");
  await ensureNotHandledByOther(session, user, force);
  if (!session.ai_paused || !sameUser(session.handler_user_id, user)) {
    session = await assumeSession(sessionId, user, { force: true });
  }
  return sendReengageTemplate(session, user);
}

// ── Presença: quem está com a conversa aberta agora (em memória) ─────────

const PRESENCE_TTL_MS = 45 * 1000; // o painel renova a cada 20 s
const presence = new Map(); // sessionId -> Map(chave do usuário -> { id, name, at })

function presenceKey(user) {
  return user?.id || `emergencia:${user?.name}`;
}

export function getViewers(sessionId) {
  return [...(presence.get(sessionId)?.values() || [])].map(({ id, name }) => ({ id, name }));
}

function emitPresence(sessionId) {
  eventBus.emit("presence", { sessionId, viewers: getViewers(sessionId) });
}

/** Marca (ou renova) que o usuário está com a conversa aberta. */
export function touchPresence(sessionId, user) {
  if (!presence.has(sessionId)) presence.set(sessionId, new Map());
  const viewers = presence.get(sessionId);
  const key = presenceKey(user);
  const isNew = !viewers.has(key);
  viewers.set(key, { id: user?.id || null, name: user?.name || "Alguém", at: Date.now() });
  if (isNew) emitPresence(sessionId);
  return getViewers(sessionId);
}

export function leavePresence(sessionId, user) {
  const viewers = presence.get(sessionId);
  if (viewers?.delete(presenceKey(user))) {
    if (viewers.size === 0) presence.delete(sessionId);
    emitPresence(sessionId);
  }
}

// Quem fechou a aba sem avisar sai sozinho depois do TTL.
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, viewers] of presence) {
    let changed = false;
    for (const [key, v] of viewers) {
      if (now - v.at > PRESENCE_TTL_MS) {
        viewers.delete(key);
        changed = true;
      }
    }
    if (viewers.size === 0) presence.delete(sessionId);
    if (changed) emitPresence(sessionId);
  }
}, 15 * 1000).unref();
