import { getDb } from "../database/db.js";
import eventBus from "../utils/events.js";
import { SYSTEM_ACTOR } from "../constants/crm.js";
import { FIRST_STAGE, FINISHED_STAGE, isValidStage, stageOf, stageFields } from "../constants/atendimento.js";
import { getSessionById } from "./chatService.js";
import { actorOf } from "./caseEventsService.js";
import { closeSession } from "./handoverService.js";

/**
 * Quadro de Atendimento: um card por cliente do WhatsApp (sessão com
 * telefone), arrastado entre as colunas de src/constants/atendimento.js.
 *
 * A etapa fica em sessions.board_stage. Toda mudança emite "sessionUpdated"
 * no eventBus — o mesmo evento da pausa da IA —, então o quadro e a tela de
 * Conversas se atualizam pelo SSE de /api/conversas/stream.
 */

export class AtendimentoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function updateSession(sessionId, fields, actor) {
  const { data, error } = await getDb().from("sessions").update(fields).eq("id", sessionId).select().single();
  if (error) throw new Error(error.message);
  eventBus.emit("sessionUpdated", { session: data, actor: actorOf(actor) });
  return data;
}

/**
 * Move o cliente para outra coluna do quadro (sempre uma pessoa). Levar para
 * "Finalizado" é o mesmo que encerrar o atendimento pela tela de Conversas.
 */
export async function moveSessionStage(sessionId, stage, user) {
  if (!isValidStage(stage)) throw new AtendimentoError("Coluna inválida.");
  const session = await getSessionById(sessionId);
  if (!session) throw new AtendimentoError("Conversa não encontrada.", 404);
  if (!session.phone) throw new AtendimentoError("Esta conversa não é do WhatsApp.");
  if (stageOf(session) === stage) return session;
  if (stage === FINISHED_STAGE) return closeSession(sessionId, user, { force: true });

  // Saindo de "Finalizado" com a IA respondendo: volta para a fila de espera.
  const requeue = stageOf(session) === FINISHED_STAGE && !session.ai_paused ? { queue_since: new Date().toISOString() } : {};
  try {
    const updated = await updateSession(sessionId, { ...stageFields(stage, user), ...requeue }, user);
    console.log(`[Atendimento] ${user?.name} moveu ${session.phone} de "${stageOf(session)}" para "${stage}".`);
    return updated;
  } catch (error) {
    console.error(`[Atendimento] Erro ao mover a conversa ${sessionId}:`, error.message);
    throw new AtendimentoError("Não foi possível mover o cliente. Confira se a migração do banco foi aplicada.", 500);
  }
}

/**
 * Chamado a cada mensagem recebida pelo WhatsApp, antes de salvá-la:
 *  - guarda o nome do perfil do WhatsApp (contacts[].profile.name) quando
 *    ele muda;
 *  - quem escreve de novo depois de "Finalizado" volta para a primeira
 *    coluna (autor: Sistema);
 *  - sem ninguém atendendo, o cliente entra na fila de "Atendimento
 *    pendente" (queue_since), se ainda não estava nela.
 * Nunca bloqueia a mensagem: se falhar (ex: migração não aplicada), só
 * registra no log e devolve a sessão como estava.
 */
export async function syncIncomingContact(session, profileName) {
  const fields = {};
  const name = typeof profileName === "string" ? profileName.trim().slice(0, 200) : "";
  if (name && name !== session.contact_name) fields.contact_name = name;

  const reopen = session.board_stage === FINISHED_STAGE;
  if (reopen) Object.assign(fields, stageFields(FIRST_STAGE, null));
  if (!session.ai_paused && (!session.queue_since || reopen)) fields.queue_since = new Date().toISOString();
  if (Object.keys(fields).length === 0) return session;

  try {
    const updated = await updateSession(session.id, fields, SYSTEM_ACTOR);
    if (reopen) console.log(`[Atendimento] ${session.phone} escreveu de novo — voltou para "${FIRST_STAGE}".`);
    return { ...session, ...updated };
  } catch (error) {
    console.error(`[Atendimento] Erro ao atualizar o contato ${session.phone}:`, error.message);
    return session;
  }
}
