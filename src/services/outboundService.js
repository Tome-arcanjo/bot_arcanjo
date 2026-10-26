import { v4 as uuidv4 } from "uuid";
import { getDb } from "../database/db.js";
import eventBus from "../utils/events.js";
import { sendWhatsAppMessage, sendWhatsAppTemplate, REENGAGE_TEMPLATE, REENGAGE_TEMPLATE_LANG } from "./whatsappService.js";

/**
 * Caminho ÚNICO de saída de mensagens para o cliente: resposta da IA,
 * mensagem de um funcionário, modelo de retomada e avisos automáticos
 * (ligação remarcada/cancelada).
 *
 * A mensagem é gravada ANTES de enviar (delivery_status "pending") e depois
 * atualizada para "sent" ou "failed" (com delivery_error). Os avisos de status
 * que a Meta manda depois pelo webhook ("delivered", "read", "failed") são
 * aplicados por applyDeliveryStatus. Assim nenhuma mensagem some em silêncio:
 * o painel mostra o que não foi entregue e o motivo.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000; // janela de atendimento da Meta
export const WINDOW_CLOSED_ERROR =
  "Fora da janela de 24 h: o cliente não fala com a gente há mais de 24 h, e o WhatsApp só aceita um modelo aprovado.";

// Ordem dos status (a Meta pode mandar fora de ordem; nunca regride).
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Estado da janela de 24 h de uma conversa: a última mensagem do CLIENTE
 * abre 24 h para texto livre. Depois disso, só modelo aprovado.
 */
export async function getWindowState(sessionId, now = Date.now()) {
  const { data, error } = await getDb()
    .from("messages")
    .select("created_at")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);

  const last = data?.[0]?.created_at || null;
  const closesAt = last ? new Date(Date.parse(last) + WINDOW_MS).toISOString() : null;
  return {
    open: Boolean(last) && Date.parse(closesAt) > now,
    lastClientMessageAt: last,
    closesAt,
    templateConfigured: Boolean(REENGAGE_TEMPLATE),
    templateName: REENGAGE_TEMPLATE || null,
  };
}

async function touchSession(sessionId) {
  await getDb().from("sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
}

function emitStatus(message) {
  eventBus.emit("messageStatus", {
    messageId: message.id,
    sessionId: message.session_id,
    status: message.delivery_status,
    error: message.delivery_error || null,
    waMessageId: message.wa_message_id || null,
  });
}

async function saveResult(message, result) {
  const fields = result.ok
    ? { delivery_status: "sent", delivery_error: null, wa_message_id: result.waMessageId || null }
    : { delivery_status: "failed", delivery_error: result.error || "Falha no envio." };
  const { error } = await getDb().from("messages").update(fields).eq("id", message.id);
  if (error) console.error(`[Envio] Não foi possível gravar o status da mensagem ${message.id}:`, error.message);
  Object.assign(message, fields);
  emitStatus(message);
}

/**
 * Grava e envia uma mensagem para o cliente da conversa.
 *
 * @param {Object} opts
 * @param {{ id: string, phone: string }} opts.session
 * @param {string} opts.content - texto (para modelos, o que aparece no painel)
 * @param {"assistant"|"human"} [opts.role]
 * @param {{ id?: string|null, name?: string }} [opts.sender] - funcionário (role "human")
 * @param {{ name: string, language?: string, params?: string[] }} [opts.template] - envia um modelo aprovado
 * @param {boolean} [opts.enforceWindow] - fora da janela de 24 h, nem tenta: grava como falha
 * @returns {Promise<{ message: Object, ok: boolean }>}
 */
export async function deliverMessage({ session, content, role = "assistant", sender = null, template = null, enforceWindow = true }) {
  const message = {
    id: uuidv4(),
    session_id: session.id,
    role,
    content,
    sender_user_id: role === "human" ? sender?.id || null : null,
    delivery_status: "pending",
    delivery_error: null,
    created_at: new Date().toISOString(),
  };
  const { error } = await getDb().from("messages").insert(message);
  if (error) throw new Error(`Não foi possível salvar a mensagem: ${error.message}`);
  await touchSession(session.id);
  eventBus.emit("newMessage", { message: { ...message }, session });

  let result;
  if (template) {
    result = await sendWhatsAppTemplate(session.phone, template.name, template.language, template.params || []);
  } else if (enforceWindow && !(await getWindowState(session.id)).open) {
    result = { ok: false, error: WINDOW_CLOSED_ERROR };
  } else {
    result = await sendWhatsAppMessage(session.phone, content);
  }

  await saveResult(message, result);
  if (!result.ok) {
    console.warn(`[Envio] Mensagem ${message.id} para ${session.phone} NÃO enviada: ${message.delivery_error}`);
  }
  return { message, ok: result.ok };
}

/** Envia o modelo de retomada configurado (WHATSAPP_TEMPLATE_REENGAGE). */
export async function sendReengageTemplate(session, sender) {
  if (!REENGAGE_TEMPLATE) {
    const err = new Error("Nenhum modelo de retomada configurado no servidor (WHATSAPP_TEMPLATE_REENGAGE).");
    err.status = 409;
    throw err;
  }
  return deliverMessage({
    session,
    content: `[Modelo de mensagem: ${REENGAGE_TEMPLATE}]`,
    role: "human",
    sender,
    template: { name: REENGAGE_TEMPLATE, language: REENGAGE_TEMPLATE_LANG },
  });
}

/** Reenvia uma mensagem que falhou (mesmo texto, mesma linha no histórico). */
export async function retryMessage(messageId) {
  const db = getDb();
  const { data: message, error } = await db.from("messages").select("*").eq("id", messageId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!message) throw Object.assign(new Error("Mensagem não encontrada."), { status: 404 });
  if (message.delivery_status !== "failed") {
    throw Object.assign(new Error("Só é possível reenviar mensagens que falharam."), { status: 409 });
  }
  const { data: session } = await db.from("sessions").select("*").eq("id", message.session_id).maybeSingle();
  if (!session) throw Object.assign(new Error("Conversa não encontrada."), { status: 404 });

  const isTemplate = message.content.startsWith("[Modelo de mensagem: ");
  if (!isTemplate && !(await getWindowState(session.id)).open) {
    throw Object.assign(new Error(WINDOW_CLOSED_ERROR), { status: 409, code: "WINDOW_CLOSED" });
  }

  await db.from("messages").update({ delivery_status: "pending", delivery_error: null }).eq("id", message.id);
  message.delivery_status = "pending";
  message.delivery_error = null;
  emitStatus(message);

  const result = isTemplate
    ? await sendWhatsAppTemplate(session.phone, REENGAGE_TEMPLATE, REENGAGE_TEMPLATE_LANG)
    : await sendWhatsAppMessage(session.phone, message.content);
  await saveResult(message, result);
  return { message, ok: result.ok };
}

/**
 * Aplica um aviso de status da Meta (webhook "statuses") à mensagem enviada.
 * A falha da janela de 24 h, por exemplo, chega SÓ por aqui — a API aceita o
 * envio e avisa depois.
 */
export async function applyDeliveryStatus(waMessageId, status, errorDetail = null) {
  if (!waMessageId || !status) return;
  const db = getDb();
  const { data: message, error } = await db.from("messages").select("*").eq("wa_message_id", waMessageId).maybeSingle();
  if (error) {
    console.error("[Envio] Erro ao buscar mensagem para status da Meta:", error.message);
    return;
  }
  if (!message) return; // ex: aviso de atraso para CALL_ALERT_PHONES (não é mensagem de conversa)

  let fields;
  if (status === "failed") {
    fields = { delivery_status: "failed", delivery_error: errorDetail || "O WhatsApp informou que a mensagem não foi entregue." };
  } else if (status in STATUS_RANK) {
    const current = STATUS_RANK[message.delivery_status] ?? -1;
    if (message.delivery_status === "failed" || STATUS_RANK[status] <= current) return;
    fields = { delivery_status: status };
  } else {
    return;
  }

  const { error: updateError } = await db.from("messages").update(fields).eq("id", message.id);
  if (updateError) {
    console.error("[Envio] Erro ao gravar status da Meta:", updateError.message);
    return;
  }
  Object.assign(message, fields);
  emitStatus(message);
  if (status === "failed") console.warn(`[Envio] A Meta informou falha na mensagem ${message.id}: ${fields.delivery_error}`);
}
