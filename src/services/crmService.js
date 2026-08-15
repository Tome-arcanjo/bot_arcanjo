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
