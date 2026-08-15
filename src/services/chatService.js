import { sendToAnthropic } from "../providers/anthropic.js";
import { sendToOpenAI } from "../providers/openai.js";
import { getDb } from "../database/db.js";
import { v4 as uuidv4 } from "uuid";
import { getCaseByPhone } from "./crmService.js";
import "dotenv/config";

const DEFAULT_PROVIDER = process.env.AI_PROVIDER || "openai";

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

  return { id, title: `WhatsApp: ${phone}`, provider, model, phone };
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
 * Processa uma mensagem do usuario e retorna a resposta da IA
 */
export async function processMessage(sessionId, userContent, provider, systemPrompt) {
  const db = getDb();

  // Verifica se a sessao existe
  const { data: sessions, error: sessionError } = await db
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .limit(1);

  if (sessionError) throw new Error(sessionError.message);
  if (!sessions || sessions.length === 0) throw new Error("Sessao nao encontrada");

  const session = sessions[0];
  const usedProvider = provider || session.provider;

  // Salva mensagem do usuario
  const userMessageId = uuidv4();
  const { error: insertUserError } = await db.from("messages").insert({
    id: userMessageId,
    session_id: sessionId,
    role: "user",
    content: userContent,
  });
  if (insertUserError) throw new Error(insertUserError.message);

  // Busca historico de mensagens para contexto (max 10)
  const { data: history, error: historyError } = await db
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (historyError) throw new Error(historyError.message);

  // Inverte para ordem cronologica antes de enviar para IA
  const historyOrdered = (history || []).reverse();

    // --- INJEÇÃO DO CRM ---
  let finalSystemPrompt = systemPrompt;
  if (session.phone) {
    try {
      const crmCase = await getCaseByPhone(session.phone);
      if (crmCase) {
        finalSystemPrompt += `\n\n[NOTA INTERNA DO SISTEMA (CRM): O cliente atual possui um processo com o status "${crmCase.status}". Urgência atual: ${crmCase.urgency_tag}. Responda de acordo, baseando-se neste status, mas NUNCA diga que você leu uma "Nota interna".]`;
      }
    } catch (e) {
      console.error("[CRM Injection Error]", e);
    }
  }
  // ----------------------

  // Chama a IA
  console.log(`[AI] Chamando ${usedProvider} com ${historyOrdered.length} msgs de contexto`);
  const assistantContent = await callAIProvider(historyOrdered, usedProvider, finalSystemPrompt);

  // Salva resposta da IA
  const assistantMessageId = uuidv4();
  const { error: insertAssistantError } = await db.from("messages").insert({
    id: assistantMessageId,
    session_id: sessionId,
    role: "assistant",
    content: assistantContent,
  });
  if (insertAssistantError) throw new Error(insertAssistantError.message);

  // Conta mensagens para decidir se atualiza o titulo
  const { count, error: countError } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (!countError) {
    const title =
      count <= 2
        ? userContent.substring(0, 50) + (userContent.length > 50 ? "..." : "")
        : session.title;

    await db
      .from("sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  return {
    id: assistantMessageId,
    role: "assistant",
    content: assistantContent,
    provider: usedProvider,
  };
}

