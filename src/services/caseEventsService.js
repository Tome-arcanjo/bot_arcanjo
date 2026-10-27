import { v4 as uuidv4 } from "uuid";
import { getDb } from "../database/db.js";
import { SYSTEM_ACTOR } from "../constants/crm.js";

/**
 * Histórico dos casos (tabela case_events): quem fez o quê e quando.
 *
 * Gravar o histórico nunca bloqueia a ação em si — se falhar (ex: migração
 * não aplicada), só registra no log. O caso já foi alterado; perder uma linha
 * de histórico é melhor do que desfazer o trabalho de quem estava mexendo.
 */

/** { id, name } de quem fez a ação (usuário logado, IA ou sistema). */
export function actorOf(user) {
  if (!user) return SYSTEM_ACTOR;
  return { id: user.id || null, name: user.name || SYSTEM_ACTOR.name };
}

export async function recordCaseEvent({ caseId = null, sessionId = null, actor, type, from = null, to = null }) {
  const who = actorOf(actor);
  const row = {
    id: uuidv4(),
    case_id: caseId,
    session_id: sessionId,
    user_id: who.id,
    actor_name: who.name,
    type,
    from_value: from == null ? null : String(from),
    to_value: to == null ? null : String(to),
    created_at: new Date().toISOString(),
  };
  const { error } = await getDb().from("case_events").insert(row);
  if (error) {
    console.error(`[CRM] Não foi possível gravar o histórico (${type}) do caso ${caseId}:`, error.message);
    return null;
  }
  return row;
}

export async function listCaseEvents(caseId, limit = 50) {
  const { data, error } = await getDb()
    .from("case_events")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Não foi possível carregar o histórico do caso.");
  return data || [];
}
