import { getDb } from "../database/db.js";

/**
 * Serviço da tabela "clients" — o cadastro de contatos (nome, email,
 * endereço, data de nascimento) capturado automaticamente pela IA a
 * partir das conversas de WhatsApp. Ver crmClassifierService.js para a
 * extração em si; este arquivo só lida com leitura/gravação no banco.
 */

// Busca todos os contatos, com filtro opcional por nome/telefone/email.
export async function listClients({ search } = {}) {
  const supabase = getDb();
  let query = supabase.from("clients").select("*").order("updated_at", { ascending: false });

  if (search) {
    const term = `%${search}%`;
    query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[Clients] Erro ao listar contatos:", error);
    return [];
  }
  return data || [];
}

export async function getClientByPhone(phone) {
  const supabase = getDb();
  const { data, error } = await supabase.from("clients").select("*").eq("phone", phone).single();
  if (error && error.code !== "PGRST116") {
    console.error(`[Clients] Erro ao buscar contato ${phone}:`, error);
  }
  return data || null;
}

/**
 * Grava/atualiza um contato de forma parcial: só os campos presentes em
 * `fields` são enviados ao Supabase, então um upsert nunca apaga um dado
 * que já estava salvo (ex: se só o e-mail veio nesta mensagem, o nome e
 * endereço já cadastrados continuam intactos).
 */
export async function upsertClientInfo(phone, fields) {
  if (!phone) return null;

  const payload = { phone, updated_at: new Date().toISOString() };
  if (fields.name) payload.name = fields.name;
  if (fields.email) payload.email = fields.email;
  if (fields.address) payload.address = fields.address;
  if (fields.birth_date) payload.birth_date = fields.birth_date;

  // Nada além do telefone pra salvar — não faz sentido gravar uma linha vazia.
  if (Object.keys(payload).length <= 2) return null;

  const supabase = getDb();
  const { data, error } = await supabase
    .from("clients")
    .upsert(payload, { onConflict: "phone" })
    .select()
    .single();

  if (error) {
    console.error(`[Clients] Erro ao salvar contato ${phone}:`, error);
    return null;
  }
  return data;
}
