import { getDb } from "../database/db.js";
import { v4 as uuidv4 } from "uuid";
import eventBus from "../utils/events.js";
import { recordCaseEvent, actorOf } from "./caseEventsService.js";

/**
 * Acesso a dados dos casos do CRM (crm_cases).
 *
 * Toda escrita passa por aqui — rotas do painel, classificador da IA e
 * ligações — e por isso é aqui que cada mudança:
 *  - grava o histórico em case_events, com o autor (`actor` = { id, name } do
 *    usuário logado, ou IA/Sistema);
 *  - emite "crmChanged" no eventBus, que o SSE /api/crm/stream repassa para o
 *    quadro de todo mundo em tempo real.
 *
 * Conflitos (duas pessoas movendo o mesmo card): vale a última gravação, e
 * o evento emitido leva o estado final para todos os quadros.
 */

function emitChange(type, { crmCase = null, caseId, actor, from = null, to = null }) {
  eventBus.emit("crmChanged", {
    type,
    caseId: caseId || crmCase?.id,
    case: crmCase,
    actor: actorOf(actor),
    from,
    to,
    at: new Date().toISOString(),
  });
}

// Busca todos os casos
export async function getCases() {
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[CRM] Erro ao buscar casos:", error);
    return [];
  }
  return data || [];
}

// Busca o caso ativo de um telefone (retorna o mais recente)
export async function getCaseByPhone(phone) {
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .select("*")
    .eq("phone", phone)
    .neq("status", "Arquivado")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("[CRM] Erro ao buscar caso para " + phone + ":", error);
  }
  return data;
}

// Cria um novo caso (sempre na coluna "Novo caso" — nunca escolhida pela IA)
export async function createCase(phone, clientName, summary = "", actor = null) {
  const supabase = getDb();
  const newCase = {
    id: uuidv4(),
    phone,
    client_name: clientName,
    status: "Novo caso",
    urgency_tag: "Normal",
    summary,
  };

  const { data, error } = await supabase
    .from("crm_cases")
    .insert([newCase])
    .select()
    .single();

  if (error) {
    console.error("[CRM] Erro ao criar caso:", error);
    return null;
  }
  await recordCaseEvent({ caseId: data.id, actor, type: "created", to: data.status });
  emitChange("created", { crmCase: data, actor, to: data.status });
  return data;
}

// Atualiza o status de um caso (movimentação no Kanban — sempre humana).
// Retorna null se o caso não existe ou se a gravação falhou.
export async function updateCaseStatus(id, status, actor = null) {
  const existing = await getCaseById(id);
  if (!existing) return null;
  if (existing.status === status) return existing;

  const who = actorOf(actor);
  const now = new Date().toISOString();
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .update({
      status,
      updated_at: now,
      status_changed_by: who.id,
      status_changed_by_name: who.name,
      status_changed_at: now,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[CRM] Erro ao atualizar status do caso " + id + ":", error);
    return null;
  }
  await recordCaseEvent({ caseId: id, actor, type: "moved", from: existing.status, to: status });
  emitChange("moved", { crmCase: data, actor, from: existing.status, to: status });
  return data;
}

function tagsLabel(urgencyTag, areaTag) {
  return [urgencyTag || "Normal", areaTag].filter(Boolean).join(" · ");
}

// Atualiza as etiquetas de um caso
export async function updateCaseTags(id, urgencyTag, areaTag, actor = null) {
  const supabase = getDb();
  const { data: before } = await supabase.from("crm_cases").select("urgency_tag, area_tag").eq("id", id).maybeSingle();

  const { data, error } = await supabase
    .from("crm_cases")
    .update({ urgency_tag: urgencyTag, area_tag: areaTag, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[CRM] Erro ao atualizar tags do caso " + id + ":", error);
    return null;
  }
  const from = before ? tagsLabel(before.urgency_tag, before.area_tag) : null;
  const to = tagsLabel(urgencyTag, areaTag);
  if (from !== to) {
    await recordCaseEvent({ caseId: id, actor, type: "tags", from, to });
  }
  emitChange("tags", { crmCase: data, actor, from, to });
  return data;
}

/**
 * Atribui (ou transfere) o caso a um funcionário — sempre humano.
 * `assignee` = { id, name } do novo responsável, ou null para "sem responsável".
 */
export async function assignCase(id, assignee, actor = null) {
  const existing = await getCaseById(id);
  if (!existing) return null;
  const newId = assignee?.id || null;
  if ((existing.assigned_to || null) === newId) return existing;

  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .update({
      assigned_to: newId,
      assigned_at: newId ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[CRM] Erro ao atribuir o caso " + id + ":", error);
    throw new Error("Não foi possível atribuir o caso. Confira se a migração do banco foi aplicada.");
  }

  let fromName = null;
  if (existing.assigned_to) {
    const { data: prev } = await supabase.from("users").select("name").eq("id", existing.assigned_to).maybeSingle();
    fromName = prev?.name || "(usuário removido)";
  }
  await recordCaseEvent({ caseId: id, actor, type: "assigned", from: fromName, to: assignee?.name || null });
  emitChange("assigned", { crmCase: data, actor, from: fromName, to: assignee?.name || null });
  return data;
}

// Exclui um caso permanentemente (ação manual de um admin, via botão no CRM).
// O evento "deleted" continua no histórico (case_events não tem FK).
export async function deleteCase(id, actor = null) {
  const supabase = getDb();
  const { data: existing } = await supabase.from("crm_cases").select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from("crm_cases").delete().eq("id", id);

  if (error) {
    console.error("[CRM] Erro ao excluir caso " + id + ":", error);
    return false;
  }
  if (existing) {
    const label = existing.client_name ? `${existing.client_name} (${existing.phone})` : existing.phone;
    await recordCaseEvent({ caseId: id, actor, type: "deleted", from: existing.status, to: label });
  }
  emitChange("deleted", { caseId: id, actor, from: existing?.status || null });
  return true;
}

// ── Ligação com o advogado ──────────────────────────────────────────────
// Campos call_* de crm_cases (ver init.sql). A regra de negócio (avisos ao
// cliente, lembretes de atraso) fica em callService.js; aqui só o acesso a dados.

export async function getCaseById(id) {
  const supabase = getDb();
  const { data, error } = await supabase.from("crm_cases").select("*").eq("id", id).maybeSingle();

  if (error) {
    console.error("[CRM] Erro ao buscar caso " + id + ":", error);
    throw new Error("Não foi possível buscar o caso.");
  }
  return data;
}

// Grava os campos call_* de um caso. Lança erro se a gravação falhar, pra
// rota não responder "sucesso" quando nada foi salvo (por exemplo, quando a
// migração das colunas call_* ainda não foi aplicada no banco).
// `label` descreve a mudança no histórico (ex: "Agendada para 12/03 às 14:00").
export async function updateCaseCall(id, fields, { actor = null, label = null } = {}) {
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[CRM] Erro ao atualizar ligação do caso " + id + ":", error);
    throw new Error("Não foi possível salvar a ligação. Confira se a migração do banco (init.sql) foi aplicada.");
  }
  if (data) {
    if (label) await recordCaseEvent({ caseId: id, actor, type: "call", to: label });
    emitChange("call", { crmCase: data, actor, to: label });
  }
  return data;
}

// Casos com ligação pendente cujo horário já passou (candidatos a aviso de atraso).
export async function getOverdueCalls(nowIso, sinceIso) {
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .select("*")
    .eq("call_status", "pendente")
    .lte("call_scheduled_at", nowIso)
    .gte("call_scheduled_at", sinceIso);

  if (error) throw new Error(error.message);
  return data || [];
}

// Reserva o próximo aviso de atraso de forma atômica: só atualiza se o
// contador ainda for o que lemos (e a ligação ainda estiver pendente).
// Retorna true se este processo "ganhou" o aviso — evita envio em dobro se
// dois ciclos do agendador se sobrepuserem ou se a ligação for concluída/
// cancelada entre a leitura e o envio.
export async function claimCallReminder(id, expectedSent, newSent) {
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .update({ call_reminders_sent: newSent })
    .eq("id", id)
    .eq("call_status", "pendente")
    .eq("call_reminders_sent", expectedSent)
    .select("id");

  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}
