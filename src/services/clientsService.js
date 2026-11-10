import { getDb } from "../database/db.js";
import eventBus from "../utils/events.js";
import { isValidTag } from "../constants/tags.js";
import { actorOf } from "./caseEventsService.js";

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

/**
 * Troca as etiquetas jurídicas do cliente (ids de src/constants/tags.js).
 * Cria o contato se ainda não existir. Avisa o painel ("clientUpdated", SSE
 * "client" em /api/conversas/stream) para conversas e quadro atualizarem.
 */
export async function setClientTags(phone, tags, actor) {
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  if (!cleanPhone) throw Object.assign(new Error("Telefone inválido."), { status: 400 });
  const list = [...new Set(Array.isArray(tags) ? tags : [])];
  const invalid = list.filter((t) => !isValidTag(t));
  if (invalid.length) throw Object.assign(new Error(`Etiqueta desconhecida: ${invalid.join(", ")}`), { status: 400 });

  const { data, error } = await getDb()
    .from("clients")
    .upsert({ phone: cleanPhone, tags: list, updated_at: new Date().toISOString() }, { onConflict: "phone" })
    .select()
    .single();
  if (error) {
    console.error(`[Clients] Erro ao salvar etiquetas de ${cleanPhone}:`, error.message);
    throw new Error("Não foi possível salvar as etiquetas. Confira se a migração do banco foi aplicada.");
  }
  eventBus.emit("clientUpdated", { phone: cleanPhone, tags: data.tags || list, actor: actorOf(actor) });
  return data;
}
