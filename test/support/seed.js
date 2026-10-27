import bcrypt from "bcryptjs";

/** Linha da tabela users com hash barato (custo 4) para os testes. */
export function userRow({ id, name, email, password, role = "atendente", active = true }) {
  return {
    id,
    name,
    email,
    password_hash: bcrypt.hashSync(password, 4),
    role,
    active,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export const EMERGENCY = { username: "admin", password: "senha-emergencia" };
export const EMERGENCY_ENV = {
  ADMIN_USERNAME: EMERGENCY.username,
  ADMIN_PASSWORD_HASH: bcrypt.hashSync(EMERGENCY.password, 4),
  SESSION_SECRET: "segredo-de-teste",
};

/** Equipe padrão: Ana (admin), Bia e Caio (atendentes), Duda (desativada). */
export const TEAM = {
  ana: { id: "u-ana", name: "Ana Souza", email: "ana@escritorio.com", password: "senha-da-ana", role: "admin" },
  bia: { id: "u-bia", name: "Bia Lima", email: "bia@escritorio.com", password: "senha-da-bia", role: "atendente" },
  caio: { id: "u-caio", name: "Caio Rocha", email: "caio@escritorio.com", password: "senha-do-caio", role: "atendente" },
  duda: { id: "u-duda", name: "Duda Alves", email: "duda@escritorio.com", password: "senha-da-duda", role: "atendente", active: false },
};

export function teamRows() {
  return Object.values(TEAM).map(userRow);
}

/** Faz login com um cliente de test/support/server.js. */
export async function loginAs(client, who) {
  const creds = who === EMERGENCY ? { username: who.username, password: who.password } : { username: who.email, password: who.password };
  const res = await client.request("/login", { method: "POST", form: creds });
  if (res.status !== 302) throw new Error(`login de ${creds.username} falhou (${res.status})`);
  return res;
}
