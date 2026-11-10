/**
 * Estado compartilhado da tela de Conversas e pequenos utilitários. Os outros
 * módulos leem/escrevem `state` e avisam mudanças com emit(); main.js liga os
 * eventos às funções de desenho.
 */
const { me, api, escapeHtml, icon } = window.Dash;
export { me, api, escapeHtml, icon };

const COLUMNS = window.ATENDIMENTO_COLUMNS || [];
export const FINISHED_STAGE = "Finalizado";

export const state = {
  sessions: [], // conversas (só WhatsApp), como em GET /api/conversas
  team: [], // [{ id, name, role, active, online }]
  tab: "chats",
  activeId: null,
  active: null, // { session, window, viewers, sending } da conversa aberta
  messages: [], // mensagens da conversa aberta (ordem cronológica)
  replyTo: null, // mensagem citada no próximo envio
};

// ── Eventos internos ─────────────────────────────────────────────────────
const listeners = new Map();
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
}
export function emit(name, payload) {
  listeners.get(name)?.forEach((fn) => fn(payload));
}

// ── localStorage (aba, ordenação) — nunca quebra a tela ───────────────────
export const prefs = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`conversas:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`conversas:${key}`, value);
    } catch {
      // modo privado etc.
    }
  },
};

// ── Equipe e conversas ───────────────────────────────────────────────────
export const userById = (id) => (id ? state.team.find((u) => u.id === id) || null : null);
export const userName = (id) => userById(id)?.name || null;
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || name;
export const isMe = (userId) => Boolean(me) && (userId || null) === (me.id || null);
export const isAdmin = () => me?.role === "admin";
export const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

export const stageOf = (s) => (COLUMNS.includes(s.board_stage) ? s.board_stage : COLUMNS[0]);

/** Situação do atendimento: alguém atende, na fila (só a IA) ou encerrado. */
export function statusOf(s) {
  if (s.ai_paused) return "atendimento";
  return stageOf(s) === FINISHED_STAGE ? "encerrado" : "fila";
}

/**
 * Aba "própria" da conversa (para onde a tela vai ao abri-la por link ou ao
 * assumir). Contatos lista todos; encerrados só aparecem lá.
 */
export function tabOf(s) {
  return { atendimento: "chats", fila: "pendentes", encerrado: "contatos" }[statusOf(s)];
}

export const sessionById = (id) => state.sessions.find((s) => s.id === id) || null;
export const activeSession = () => (state.active ? { ...sessionById(state.activeId), ...state.active.session } : sessionById(state.activeId));

/** Mescla campos numa conversa da lista (e na aberta) e avisa a tela. */
export function patchSession(id, fields) {
  const i = state.sessions.findIndex((s) => s.id === id);
  if (i !== -1) state.sessions[i] = { ...state.sessions[i], ...fields };
  if (state.active && state.active.session.id === id) state.active.session = { ...state.active.session, ...fields };
  emit("sessions");
  if (id === state.activeId) emit("active");
}

export const lastActivity = (s) => s.lastMessage?.created_at || s.updated_at || s.created_at || "";
export const waitingSince = (s) => s.queue_since || lastActivity(s);

// ── Mensagens ────────────────────────────────────────────────────────────
export const messageById = (id) => state.messages.find((m) => m.id === id) || null;
export const mediaUrl = (m, download) => `/api/conversas/media/${encodeURIComponent(m.id)}${download ? "?download=1" : ""}`;

// Tipos que não são texto: [rótulo, ícone].
const TYPES = {
  image: ["Imagem", "image"],
  audio: ["Áudio", "mic"],
  video: ["Vídeo", "video"],
  document: ["Documento", "file"],
  sticker: ["Figurinha", "sticker"],
  location: ["Localização", "map-pin"],
  contacts: ["Contato", "user"],
};

/** Texto curto da mensagem (prévias, citação, encaminhar). */
export function messageSummary(m) {
  if (!m) return "";
  if (m.deleted_at) return "Mensagem apagada";
  const type = TYPES[m.message_type];
  if (type) return m.media?.caption ? `${type[0]}: ${m.media.caption}` : type[0];
  return m.content || "";
}

/** O mesmo resumo em HTML, com o ícone do tipo (anexo, apagada). */
export function summaryHtml(m) {
  if (!m) return "";
  const name = m.deleted_at ? "ban" : TYPES[m.message_type]?.[1];
  return (name ? icon(name, "icon-inline") + " " : "") + escapeHtml(messageSummary(m));
}

/** Ícone do tipo de anexo (bandeja de envio, galeria). */
export const typeIcon = (type) => icon(TYPES[type]?.[1] || "file");

export function authorName(m) {
  if (m.role === "user") return null;
  if (m.role === "human") return isMe(m.sender_user_id) ? "Você" : userName(m.sender_user_id) || "Equipe";
  return "IA";
}

/** Nome de quem escreveu, para a citação ("Cliente", "Você", "Ana", "IA"). */
export function quoteAuthor(m) {
  return m.role === "user" ? "Cliente" : authorName(m);
}

// ── Formatação estilo WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```) ──
export function formatText(text) {
  return escapeHtml(text)
    .replace(/```([\s\S]+?)```/g, "<code>$1</code>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?)]|$)/g, "$1<strong>$2</strong>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?)]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s.,!?)]|$)/g, "$1<s>$2</s>")
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "agora", "12 min", "2 h 5 min", "3 d" — tempo de espera na fila. */
export function fmtWait(iso) {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(min) || min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// ── Ações com confirmação quando outra pessoa está atendendo ──────────────
function confirmTakeover(err, what) {
  const name = err.body?.handler?.name || "Outra pessoa";
  return confirm(`${name} está atendendo esta conversa.\n${what} mesmo assim? A conversa passa para você.`);
}

/** Executa request(force); se outra pessoa atende, pergunta e repete com force. */
export async function withTakeover(request, what) {
  try {
    return await request(false);
  } catch (err) {
    if (err.code === "HANDLED_BY_OTHER" && confirmTakeover(err, what)) return request(true);
    if (err.code === "HANDLED_BY_OTHER") return null;
    throw err;
  }
}

/** Abre/fecha um .modal-overlay (fecha no fundo, no ✕ e em [data-close]). */
export function modal(id) {
  const overlay = document.getElementById(id);
  const close = () => overlay.classList.remove("open");
  if (!overlay.dataset.bound) {
    overlay.dataset.bound = "1";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) close();
    });
  }
  return { overlay, open: () => overlay.classList.add("open"), close };
}
