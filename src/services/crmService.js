import { getDb } from "../database/db.js";
import { v4 as uuidv4 } from "uuid";

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

// Cria um novo caso
export async function createCase(phone, clientName, summary = "") {
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
  return data;
}

// Atualiza o status de um caso (movimentação no Kanban)
export async function updateCaseStatus(id, status) {
  const supabase = getDb();
  const { data, error } = await supabase
    .from("crm_cases")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[CRM] Erro ao atualizar status do caso " + id + ":", error);
    return null;
  }
  return data;
}

// Atualiza as etiquetas de um caso
export async function updateCaseTags(id, urgencyTag, areaTag) {
  const supabase = getDb();
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
  return data;
}

// Exclui um caso permanentemente (ação manual do usuário, via botão no CRM)
export async function deleteCase(id) {
  const supabase = getDb();
  const { error } = await supabase.from("crm_cases").delete().eq("id", id);

  if (error) {
    console.error("[CRM] Erro ao excluir caso " + id + ":", error);
    return false;
  }
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
export async function updateCaseCall(id, fields) {
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
