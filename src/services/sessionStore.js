import session from "express-session";
import { getDb } from "../database/db.js";

/**
 * Store do express-session gravado no Supabase (tabela web_sessions), para
 * que o login sobreviva a um "pm2 restart" e para conseguir derrubar todas as
 * sessões de um usuário (desativado, papel ou senha trocados).
 *
 * Cache em memória: o express-session lê a sessão em TODA requisição, e ir ao
 * Supabase a cada uma deixaria o painel lento. Como o app roda em um único
 * processo (ver ecosystem.config.cjs) e toda escrita passa por aqui, o cache
 * fica sempre coerente; o TTL curto só existe para limitar memória e para
 * pegar alterações feitas direto no banco.
 */

const CACHE_TTL_MS = 60 * 1000;
const TOUCH_INTERVAL_MS = 10 * 60 * 1000; // estende a validade no banco no máximo 1x a cada 10 min
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Por quanto tempo um sid encerrado continua bloqueado. Uma requisição que já
// estava em andamento (ex: uma conexão SSE) termina DEPOIS da revogação e o
// express-session chama set/touch para ela — sem esse bloqueio, a sessão
// derrubada voltaria a existir.
const TOMBSTONE_MS = 30 * 60 * 1000;

function expiresAt(sess) {
  const expires = sess?.cookie?.expires;
  if (expires) return new Date(expires);
  const maxAge = sess?.cookie?.originalMaxAge;
  return new Date(Date.now() + (typeof maxAge === "number" ? maxAge : DEFAULT_MAX_AGE_MS));
}

function dbError(action, error) {
  if (/web_sessions/.test(error.message) && /(does not exist|schema cache)/.test(error.message)) {
    console.error("[Sessão] Tabela web_sessions não encontrada — rode a migração (init.sql / migrations/).");
  } else {
    console.error(`[Sessão] Erro ao ${action}:`, error.message);
  }
  return new Error(`Não foi possível ${action}.`);
}

export class SupabaseSessionStore extends session.Store {
  constructor() {
    super();
    this.cache = new Map(); // sid -> { sess, userId, expire (ms), touchedAt (ms), cachedAt (ms) }
    this.tombstones = new Map(); // sid encerrado -> até quando fica bloqueado (ms)
    this.cleanupTimer = setInterval(() => this.clearExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  bury(sid) {
    this.cache.delete(sid);
    this.tombstones.set(sid, Date.now() + TOMBSTONE_MS);
  }

  isBuried(sid) {
    const until = this.tombstones.get(sid);
    if (until === undefined) return false;
    if (until <= Date.now()) {
      this.tombstones.delete(sid);
      return false;
    }
    return true;
  }

  remember(sid, sess, expire, touchedAt = Date.now()) {
    this.cache.set(sid, {
      sess: JSON.stringify(sess),
      userId: sess?.user?.id || null,
      expire: expire.getTime(),
      touchedAt,
      cachedAt: Date.now(),
    });
  }

  get(sid, callback) {
    this.load(sid).then((sess) => callback(null, sess), callback);
  }

  async load(sid) {
    const now = Date.now();
    const cached = this.cache.get(sid);
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      if (cached.expire <= now) {
        await this.remove(sid);
        return null;
      }
      return JSON.parse(cached.sess);
    }

    const { data, error } = await getDb().from("web_sessions").select("sess, expire").eq("sid", sid).maybeSingle();
    if (error) throw dbError("ler a sessão de login", error);
    if (!data) {
      this.cache.delete(sid);
      return null;
    }

    const expire = new Date(data.expire);
    if (expire.getTime() <= now) {
      await this.remove(sid);
      return null;
    }
    // touchedAt = agora: a validade gravada no banco é recente o bastante.
    this.remember(sid, data.sess, expire);
    return data.sess;
  }

  set(sid, sess, callback) {
    this.save(sid, sess).then(() => callback?.(null), (err) => callback?.(err));
  }

  async save(sid, sess) {
    if (this.isBuried(sid)) return; // sessão já derrubada: não ressuscita
    const expire = expiresAt(sess);
    const { error } = await getDb()
      .from("web_sessions")
      .upsert({ sid, sess, expire: expire.toISOString(), user_id: sess?.user?.id || null }, { onConflict: "sid" });
    if (error) throw dbError("salvar a sessão de login", error);
    this.remember(sid, sess, expire);
  }

  touch(sid, sess, callback) {
    this.extend(sid, sess).then(() => callback?.(null), (err) => callback?.(err));
  }

  async extend(sid, sess) {
    const cached = this.cache.get(sid);
    const expire = expiresAt(sess);
    if (cached && Date.now() - cached.touchedAt < TOUCH_INTERVAL_MS) {
      cached.expire = Math.max(cached.expire, expire.getTime());
      return;
    }
    const { data, error } = await getDb()
      .from("web_sessions")
      .update({ expire: expire.toISOString() })
      .eq("sid", sid)
      .select("sid");
    if (error) throw dbError("renovar a sessão de login", error);
    // Só volta ao cache se a sessão ainda existe no banco (pode ter sido
    // derrubada enquanto a requisição estava em andamento).
    if ((data || []).length > 0 && !this.isBuried(sid)) this.remember(sid, sess, expire);
  }

  destroy(sid, callback) {
    this.remove(sid).then(() => callback?.(null), (err) => callback?.(err));
  }

  async remove(sid) {
    this.bury(sid);
    const { error } = await getDb().from("web_sessions").delete().eq("sid", sid);
    if (error) throw dbError("encerrar a sessão de login", error);
  }

  /** Derruba todas as sessões de um usuário (exceto, opcionalmente, a atual). */
  async destroyByUser(userId, exceptSid = null) {
    if (!userId) return;
    for (const [sid, entry] of this.cache) {
      if (entry.userId === userId && sid !== exceptSid) this.bury(sid);
    }
    let query = getDb().from("web_sessions").delete().eq("user_id", userId);
    if (exceptSid) query = query.neq("sid", exceptSid);
    const { data, error } = await query.select("sid");
    if (error) throw dbError("encerrar as sessões do usuário", error);
    for (const row of data || []) this.bury(row.sid);
  }

  /** Atualiza nome/e-mail do usuário guardados nas sessões abertas dele. */
  async updateUserInSessions(userId, fields) {
    const { data, error } = await getDb().from("web_sessions").select("sid, sess, expire").eq("user_id", userId);
    if (error) throw dbError("atualizar as sessões do usuário", error);
    for (const row of data || []) {
      const sess = { ...row.sess, user: { ...row.sess.user, ...fields } };
      await this.save(row.sid, sess);
    }
  }

  async clearExpired() {
    const { error } = await getDb().from("web_sessions").delete().lt("expire", new Date().toISOString());
    if (error) {
      dbError("limpar sessões expiradas", error);
      return;
    }
    const now = Date.now();
    for (const [sid, entry] of this.cache) {
      if (entry.expire <= now) this.cache.delete(sid);
    }
    for (const [sid, until] of this.tombstones) {
      if (until <= now) this.tombstones.delete(sid);
    }
  }
}

// Instância única, compartilhada pelo server.js (express-session) e pelo
// usersService (que derruba sessões ao desativar/trocar senha/papel).
export const sessionStore = new SupabaseSessionStore();
