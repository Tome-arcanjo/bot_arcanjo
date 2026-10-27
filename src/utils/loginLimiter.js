/**
 * Limite de tentativas de login, em memória (sem dependência nova).
 *
 * Dois contadores por janela de 15 min:
 *  - IP + usuário digitado: 5 falhas bloqueiam aquele par;
 *  - só IP: 20 falhas bloqueiam o IP inteiro (quem testa vários usuários).
 *
 * O par IP+usuário existe porque, atrás do Cloudflare sem "real_ip" no Nginx,
 * todos os funcionários chegam com o mesmo IP — bloquear só por IP deixaria
 * qualquer um trancar o escritório inteiro de fora errando a senha.
 *
 * O app roda em um único processo (ver ecosystem.config.cjs), então guardar
 * em memória é suficiente; reiniciar o servidor zera os contadores.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USER = 5;
const MAX_FAILURES_PER_IP = 20;

const failures = new Map(); // chave -> { count, resetAt }

function userKey(ip, username) {
  return `u:${ip}:${String(username || "").trim().toLowerCase()}`;
}

function ipKey(ip) {
  return `ip:${ip}`;
}

function activeEntry(key, now) {
  const entry = failures.get(key);
  if (!entry) return null;
  if (entry.resetAt <= now) {
    failures.delete(key);
    return null;
  }
  return entry;
}

function bump(key, now) {
  const entry = activeEntry(key, now) || { count: 0, resetAt: now + WINDOW_MS };
  entry.count += 1;
  failures.set(key, entry);
}

/** Quantos ms faltam para liberar o login (0 = liberado). */
export function loginRetryAfterMs(ip, username, now = Date.now()) {
  const byUser = activeEntry(userKey(ip, username), now);
  const byIp = activeEntry(ipKey(ip), now);
  let wait = 0;
  if (byUser && byUser.count >= MAX_FAILURES_PER_USER) wait = Math.max(wait, byUser.resetAt - now);
  if (byIp && byIp.count >= MAX_FAILURES_PER_IP) wait = Math.max(wait, byIp.resetAt - now);
  return wait;
}

export function registerLoginFailure(ip, username, now = Date.now()) {
  bump(userKey(ip, username), now);
  bump(ipKey(ip), now);
}

/** Login certo zera o contador daquele usuário (o do IP expira sozinho). */
export function clearLoginFailures(ip, username) {
  failures.delete(userKey(ip, username));
}

// Limpeza periódica para o Map não crescer com IPs que nunca voltam.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
}, WINDOW_MS).unref();
