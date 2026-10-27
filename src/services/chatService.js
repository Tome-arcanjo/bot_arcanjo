import { sendToAnthropic } from "../providers/anthropic.js";
import { sendToOpenAI } from "../providers/openai.js";
import { getDb } from "../database/db.js";
import { v4 as uuidv4 } from "uuid";
import { getCaseByPhone } from "./crmService.js";
import { classifyAndUpdateCrmCase } from "./crmClassifierService.js";
import { getSettings } from "./settingsService.js";
import eventBus from "../utils/events.js";
import "dotenv/config";

const DEFAULT_PROVIDER = process.env.AI_PROVIDER || "openai";
const HISTORY_LIMIT = 10; // mensagens de contexto enviadas para a IA

/**
 * Envia mensagem para o provedor de IA escolhido
 */
async function callAIProvider(messages, provider, systemPrompt) {
  switch (provider) {
    case "openai":
      return await sendToOpenAI(messages, systemPrompt);
    case "anthropic":
    default:
      return await sendToAnthropic(messages, systemPrompt);
  }
}

/**
 * Cria uma nova sessao de conversa
 */
export async function createSession(provider = DEFAULT_PROVIDER) {
  const db = getDb();
  const id = uuidv4();
  const model =
    provider === "openai"
      ? process.env.OPENAI_MODEL || "gpt-4o-mini"
      : process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";

  const { error } = await db.from("sessions").insert({
    id,
    title: "Nova conversa",
    provider,
    model,
  });

  if (error) throw new Error(error.message);

  return { id, title: "Nova conversa", provider, model };
}

/**
 * Cria ou recupera uma sessao de conversa vinculada a um numero de telefone (WhatsApp)
 */
export async function getOrCreateSessionByPhone(phone, provider = DEFAULT_PROVIDER) {
  const db = getDb();

  // Verifica se ja existe sessao para este telefone
  const { data: existingSessions, error: searchError } = await db
    .from("sessions")
    .select("*")
    .eq("phone", phone)
    .limit(1);

  if (searchError) throw new Error(searchError.message);

  if (existingSessions && existingSessions.length > 0) {
    return existingSessions[0];
  }

  // Cria nova sessao vinculada ao telefone
  const id = uuidv4();
  const model =
    provider === "openai"
      ? process.env.OPENAI_MODEL || "gpt-4o-mini"
      : process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";

  const { error: insertError } = await db.from("sessions").insert({
    id,
    title: `WhatsApp: ${phone}`,
    provider,
    model,
    phone,
  });

  if (insertError) throw new Error(insertError.message);

  return { id, title: `WhatsApp: ${phone}`, provider, model, phone, ai_paused: false, handler_user_id: null };
}

export async function getSessionById(sessionId) {
  const { data, error } = await getDb().from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Lista todas as sessoes de conversa
 */
export async function listSessions() {
  const db = getDb();
  const { data, error } = await db
    .from("sessions")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Deleta uma sessao de conversa
 */
export async function deleteSession(sessionId) {
  const db = getDb();
  const { error } = await db.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(error.message);
}

/**
 * Busca mensagens de uma sessao
 */
export async function getSessionMessages(sessionId) {
  const db = getDb();
  const { data, error } = await db
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Salva uma mensagem recebida do cliente, avisa o painel (SSE) e dispara a
 * classificação do CRM. Vale com a IA ativa ou pausada (atendimento humano):
 * a mensagem do cliente sempre fica registrada e o caso continua sendo
 * classificado.
 *
 * @param {Object} session - linha de sessions
 * @param {string} content
 * @param {{ classify?: boolean }} [opts] - classify: false para avisos como "[o cliente enviou uma imagem]"
 */
export async function saveIncomingMessage(session, content, { classify = true } = {}) {
  const db = getDb();
  const message = {
    id: uuidv4(),
    session_id: session.id,
    role: "user",
    content,
    created_at: new Date().toISOString(),
  };
  const { error } = await db.from("messages").insert(message);
  if (error) throw new Error(error.message);

  // Emite evento para o SSE (painel em tempo real)
  eventBus.emit("newMessage", { message, session });

  // --- CLASSIFICAÇÃO AUTOMÁTICA DO CRM ---
  // Roda em segundo plano (sem "await") para não atrasar a resposta ao
  // cliente. A IA aqui só classifica (resumo/urgência/área) — nunca move
  // o caso no Kanban nem toma decisões; isso continua manual. Só se aplica
  // a conversas de WhatsApp (sessões com telefone associado).
  if (classify && session.phone) {
    classifyAndUpdateCrmCase({
      phone: session.phone,
      userContent: content,
      provider: session.provider || DEFAULT_PROVIDER,
    }).catch((e) => console.error("[CRM Classifier]", e.message));
  }
  // ----------------------------------------

  // A primeira mensagem do cliente vira o título da conversa.
  const { count, error: countError } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .eq("role", "user");

  const update = { updated_at: new Date().toISOString() };
  if (!countError && count <= 1) {
    update.title = content.substring(0, 50) + (content.length > 50 ? "..." : "");
  }
  await db.from("sessions").update(update).eq("id", session.id);

  return message;
}

/**
 * Converte o histórico salvo para o formato que as APIs de IA aceitam:
 *  - mensagens de funcionários ("human") viram "assistant" — para o modelo
 *    é tudo "o escritório falando";
 *  - mensagens que não chegaram ao cliente (delivery_status "failed") ficam
 *    de fora, senão a IA acharia que o cliente leu algo que nunca recebeu;
 *  - turnos seguidos do mesmo papel são unidos e o histórico sempre começa
 *    pelo cliente (exigências das APIs de chat).
 * Função pura. `rows` em ordem cronológica.
 */
export function toAiHistory(rows) {
  const turns = [];
  for (const m of rows || []) {
    if (m.delivery_status === "failed") continue;
    const role = m.role === "human" ? "assistant" : m.role;
    if (role !== "user" && role !== "assistant") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${m.content}`;
    else turns.push({ role, content: m.content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

/**
 * Gera (sem salvar nem enviar) a resposta da IA para a conversa, usando as
 * últimas mensagens como contexto. Quem envia é o outboundService.
 */
export async function generateAiReply(session, systemPrompt) {
  const db = getDb();
  const { data: history, error: historyError } = await db
    .from("messages")
    .select("role, content, delivery_status, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (historyError) throw new Error(historyError.message);

  // Inverte para ordem cronologica antes de enviar para IA
  const messages = toAiHistory((history || []).reverse());
  const usedProvider = session.provider || DEFAULT_PROVIDER;

  // --- INJEÇÃO DO CRM ---
  // Importante: se nenhum systemPrompt explícito foi passado (é o caso do
  // WhatsApp, que sempre usa a personalidade configurada no admin), cai
  // aqui para a personalidade compartilhada ANTES de qualquer concatenação
  // abaixo. Sem isso, "undefined" + a nota do CRM virava uma string
  // literal "undefinedNota..." que era usada no lugar da personalidade
  // configurada — por isso ela parecia "travada" sempre que o cliente já
  // tinha um caso aberto no CRM.
  let finalSystemPrompt = systemPrompt || getSettings().systemPrompt;
  if (session.phone) {
    try {
      const crmCase = await getCaseByPhone(session.phone);
      if (crmCase) {
        finalSystemPrompt += `\n\n[NOTA INTERNA DO SISTEMA (CRM): O cliente atual possui um processo com o status "${crmCase.status}". Urgência atual: ${crmCase.urgency_tag}. Responda de acordo, baseando-se neste status, mas NUNCA diga que você leu uma "Nota interna".]`;
        if (crmCase.call_status === "pendente" && crmCase.call_scheduled_at) {
          const when = new Date(crmCase.call_scheduled_at).toLocaleString("pt-BR", {
            timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo",
            dateStyle: "short",
            timeStyle: "short",
          });
          finalSystemPrompt += `\n\n[NOTA INTERNA DO SISTEMA (LIGAÇÃO): Há uma ligação do advogado com este cliente agendada para ${when}. Se o cliente perguntar sobre a ligação, informe esse horário. Não prometa outro horário nem tente remarcar — remarcações são feitas pela equipe. NUNCA diga que você leu uma "Nota interna".]`;
        }
      }
    } catch (e) {
      console.error("[CRM Injection Error]", e);
    }
  }
  // ----------------------

  console.log(`[AI] Chamando ${usedProvider} com ${messages.length} msgs de contexto`);
  return await callAIProvider(messages, usedProvider, finalSystemPrompt);
}
