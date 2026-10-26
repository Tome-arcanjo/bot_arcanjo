import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../database/db.js";
import { sessionStore } from "./sessionStore.js";
import eventBus from "../utils/events.js";

/**
 * Funcionários com acesso ao painel (tabela users).
 *
 * Papéis: "admin" gerencia usuários e pode excluir casos; "atendente" faz todo
 * o resto. Usuários com histórico nunca são apagados — só desativados — para
 * não perder a autoria de mensagens, movimentações e atribuições.
 *
 * Toda mudança que afeta o acesso (desativar, trocar papel, redefinir senha)
 * derruba as sessões abertas da pessoa e fecha os painéis em tempo real dela.
 */

export const ROLES = ["admin", "atendente"];
const BCRYPT_COST = 12;
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // limite do bcrypt: o resto seria ignorado em silêncio
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Hash de uma senha qualquer, usado para gastar o mesmo tempo quando o e-mail
// não existe (não revela quais e-mails estão cadastrados pelo tempo de resposta).
const DUMMY_HASH = bcrypt.hashSync("senha-inexistente", BCRYPT_COST);

// Erro de validação/regra de negócio, com o status HTTP que a rota devolve.
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Usuário sem o hash da senha (o que pode sair na API e na sessão). */
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
  };
}

/** O que fica guardado em req.session.user. */
export function sessionUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function validateName(name) {
  const clean = String(name || "").trim();
  if (clean.length < 2 || clean.length > 100) throw new UserError("Informe um nome entre 2 e 100 caracteres.");
  return clean;
}

function validateEmail(email) {
  const clean = normalizeEmail(email);
  if (!EMAIL_RE.test(clean) || clean.length > 200) throw new UserError("E-mail inválido.");
  return clean;
}

function validateRole(role) {
  if (!ROLES.includes(role)) throw new UserError("Papel inválido (use admin ou atendente).");
  return role;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new UserError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new UserError("Senha longa demais (máximo de 72 bytes).");
  }
  return password;
}

function dbFail(action, error) {
  if (error.code === "23505") return new UserError("Já existe um usuário com esse e-mail.", 409);
  console.error(`[Usuários] Erro ao ${action}:`, error.message);
  return new Error(`Não foi possível ${action}.`);
}

async function revokeAccess(userId, exceptSid = null) {
  await sessionStore.destroyByUser(userId, exceptSid);
  if (!exceptSid) eventBus.emit("userRevoked", { userId });
}

// ── Consultas ───────────────────────────────────────────────────────────

export async function listUsers() {
  const { data, error } = await getDb().from("users").select("*").order("name", { ascending: true });
  if (error) throw dbFail("listar os usuários", error);
  return (data || []).map(publicUser);
}

/**
 * Lista enxuta da equipe ({ id, name, role, active }) para qualquer usuário
 * logado: seletor de responsável, avatares do Kanban e das Conversas. Inclui
 * os desativados para os casos antigos continuarem mostrando o nome.
 */
export async function listTeam() {
  const { data, error } = await getDb().from("users").select("id, name, role, active").order("name", { ascending: true });
  if (error) throw dbFail("listar a equipe", error);
  return (data || []).map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active }));
}

export async function getUserById(id) {
  const { data, error } = await getDb().from("users").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFail("buscar o usuário", error);
  return data;
}

async function requireUser(id) {
  const user = await getUserById(id);
  if (!user) throw new UserError("Usuário não encontrado.", 404);
  return user;
}

async function countOtherActiveAdmins(exceptId) {
  const { data, error } = await getDb()
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("active", true)
    .neq("id", exceptId);
  if (error) throw dbFail("conferir os administradores", error);
  return (data || []).length;
}

/**
 * Confere e-mail e senha. Retorna o usuário (linha do banco) se estiver
 * certo e ativo, ou null. Lança erro só se o banco falhar.
 */
export async function verifyCredentials(email, password) {
  const clean = normalizeEmail(email);
  if (!clean || typeof password !== "string" || !password) return null;

  const { data, error } = await getDb().from("users").select("*").eq("email", clean).maybeSingle();
  if (error) throw dbFail("conferir o login", error);

  const ok = await bcrypt.compare(password, data?.password_hash || DUMMY_HASH);
  if (!data || !ok || !data.active) return null;
  return data;
}

// ── Gestão (admin) ──────────────────────────────────────────────────────

export async function createUser({ name, email, password, role }) {
  const row = {
    id: uuidv4(),
    name: validateName(name),
    email: validateEmail(email),
    password_hash: await bcrypt.hash(validatePassword(password), BCRYPT_COST),
    role: validateRole(role || "atendente"),
    active: true,
  };
  const { data, error } = await getDb().from("users").insert(row).select().single();
  if (error) throw dbFail("criar o usuário", error);
  return publicUser(data);
}

/**
 * Edita nome, e-mail, papel e/ou ativo. Regras: ninguém se rebaixa nem se
 * desativa (evita trancar o painel sem querer) e sempre sobra um admin ativo.
 */
export async function updateUser(id, changes, actor) {
  const current = await requireUser(id);
  const fields = {};

  if (changes.name !== undefined) fields.name = validateName(changes.name);
  if (changes.email !== undefined) fields.email = validateEmail(changes.email);
  if (changes.role !== undefined) fields.role = validateRole(changes.role);
  if (changes.active !== undefined) {
    if (typeof changes.active !== "boolean") throw new UserError("Campo 'active' inválido.");
    fields.active = changes.active;
  }
  if (Object.keys(fields).length === 0) throw new UserError("Nada para alterar.");

  const losesAdmin =
    current.role === "admin" &&
    current.active &&
    ((fields.role && fields.role !== "admin") || fields.active === false);
  if (losesAdmin && actor?.id === id) {
    throw new UserError("Você não pode remover o seu próprio acesso de administrador nem se desativar.", 409);
  }
  if (losesAdmin && (await countOtherActiveAdmins(id)) === 0) {
    throw new UserError("É preciso manter pelo menos um administrador ativo.", 409);
  }

  const { data, error } = await getDb()
    .from("users")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw dbFail("salvar o usuário", error);

  const accessChanged =
    (fields.role && fields.role !== current.role) || (fields.active !== undefined && fields.active !== current.active);
  if (accessChanged) {
    await revokeAccess(id);
  } else if (fields.name || fields.email) {
    await sessionStore.updateUserInSessions(id, { name: data.name, email: data.email });
  }
  return publicUser(data);
}

/** Admin define uma senha nova para alguém (derruba as sessões dessa pessoa). */
export async function resetPassword(id, password) {
  await requireUser(id);
  const password_hash = await bcrypt.hash(validatePassword(password), BCRYPT_COST);
  const { error } = await getDb()
    .from("users")
    .update({ password_hash, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw dbFail("redefinir a senha", error);
  await revokeAccess(id);
}

/**
 * Exclusão definitiva — só para quem nunca deixou rastro (ex: criado por
 * engano). Quem tem histórico deve ser desativado.
 */
export async function deleteUser(id, actor) {
  const user = await requireUser(id);
  if (actor?.id === id) throw new UserError("Você não pode excluir o seu próprio usuário.", 409);
  if (user.role === "admin" && user.active && (await countOtherActiveAdmins(id)) === 0) {
    throw new UserError("É preciso manter pelo menos um administrador ativo.", 409);
  }

  const db = getDb();
  const references = [
    db.from("messages").select("id", { count: "exact", head: true }).eq("sender_user_id", id),
    db.from("case_events").select("id", { count: "exact", head: true }).eq("user_id", id),
    db.from("crm_cases").select("id", { count: "exact", head: true }).eq("assigned_to", id),
    db.from("crm_cases").select("id", { count: "exact", head: true }).eq("status_changed_by", id),
    db.from("sessions").select("id", { count: "exact", head: true }).eq("handler_user_id", id),
  ];
  for (const result of await Promise.all(references)) {
    if (result.error) throw dbFail("conferir o histórico do usuário", result.error);
    if (result.count > 0) {
      throw new UserError("Este usuário tem histórico no sistema — desative-o em vez de excluir.", 409);
    }
  }

  await revokeAccess(id);
  const { error } = await db.from("users").delete().eq("id", id);
  if (error) throw dbFail("excluir o usuário", error);
}

// ── Própria conta ───────────────────────────────────────────────────────

/** Troca a própria senha; mantém a sessão atual e derruba as outras. */
export async function changeOwnPassword(id, currentPassword, newPassword, currentSid) {
  const user = await requireUser(id);
  const ok = typeof currentPassword === "string" && (await bcrypt.compare(currentPassword, user.password_hash));
  if (!ok) throw new UserError("Senha atual incorreta.", 403);

  const password_hash = await bcrypt.hash(validatePassword(newPassword), BCRYPT_COST);
  const { error } = await getDb()
    .from("users")
    .update({ password_hash, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw dbFail("trocar a senha", error);
  await revokeAccess(id, currentSid);
}
