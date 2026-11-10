/**
 * Tela de Conversas (estilo WhatsApp). Liga os módulos:
 *  - store.js    estado compartilhado e utilitários
 *  - list.js     abas Chats / Pendentes / Encerrados, fila e filtros
 *  - thread.js   conversa aberta, mensagens e menu de cada mensagem
 *  - composer.js resposta: texto, anexos, emojis, figurinhas, áudio
 *  - drawer.js   dados do cliente, etiquetas, transferir, encerrar, encaminhar
 *
 * A lista chega pronta no HTML (window.CONVERSAS_BOOT, montada no servidor);
 * depois tudo se atualiza pelo SSE de /api/conversas/stream.
 */
import { state, on, emit, api, escapeHtml, sessionById, patchSession, tabOf, onlyDigits } from "./store.js";
import { initList, renderList, setTab } from "./list.js";
import { renderThread, appendMessage, updateMessage, renderHeader, renderPresence, renderWindow, reopenWindow, closeMenu } from "./thread.js";
import { renderDrawer, setTagsLocal } from "./drawer.js";
import "./composer.js";

const threadEl = document.getElementById("conversasThread");

// ── Dados ────────────────────────────────────────────────────────────────
const onlyWhatsApp = (list) => (list || []).filter((s) => s.phone);

async function loadConversas() {
  try {
    const [conv, team] = await Promise.all([api("/api/conversas"), api("/api/crm/users")]);
    state.sessions = onlyWhatsApp(conv.data);
    state.team = team.data || [];
    renderList();
  } catch {
    document.getElementById("conversasList").innerHTML = `<p class="dash-empty">Erro ao carregar conversas.</p>`;
  }
}

// ── Abrir uma conversa ───────────────────────────────────────────────────
async function select(id) {
  const session = sessionById(id);
  if (!session) return;
  if (state.activeId && state.activeId !== id) leavePresence(state.activeId);
  state.activeId = id;
  state.active = null;
  state.messages = [];
  closeMenu();
  patchSession(id, { unanswered: session.unanswered }); // redesenha a lista com o item ativo
  emit("opened");
  threadEl.innerHTML = `<p class="dash-empty">Carregando mensagens...</p>`;
  try {
    const [msgs, st] = await Promise.all([api(`/api/conversas/${id}/messages`), api(`/api/conversas/${id}/state`)]);
    if (state.activeId !== id) return; // trocou de conversa no meio
    state.messages = msgs.data || [];
    state.active = st.data;
    renderThread();
    renderHeader();
    renderPresence();
    renderWindow();
    renderDrawer();
    sendPresence();
    const input = document.getElementById("composerInput");
    if (!input.disabled) input.focus();
  } catch {
    threadEl.innerHTML = `<p class="dash-empty">Erro ao carregar a conversa.</p>`;
  }
}
on("select", select);

// Assumi (ou respondi): a conversa passa para a aba Chats — a lista acompanha.
on("handled", () => {
  const s = sessionById(state.activeId);
  if (s && tabOf(s) !== state.tab) setTab(tabOf(s));
});
on("sessions", renderList);

// /dashboard/conversas?phone=5511999999999 (link do quadro ou do CRM) — compara só os dígitos.
function openFromDeepLink() {
  const phone = new URLSearchParams(location.search).get("phone");
  if (!phone) return;
  const match = state.sessions.find((s) => onlyDigits(s.phone) === onlyDigits(phone));
  if (!match) {
    threadEl.innerHTML = `<p class="dash-empty">Ainda não há conversa registrada com o número ${escapeHtml(phone)}.</p>`;
    return;
  }
  setTab(tabOf(match));
  select(match.id);
  const url = new URL(location);
  url.searchParams.delete("phone");
  history.replaceState({}, "", url);
}

// ── Presença ("estou com esta conversa aberta") ──────────────────────────
function sendPresence() {
  if (!state.activeId || document.visibilityState !== "visible") return;
  api(`/api/conversas/${state.activeId}/presence`, { method: "POST", body: {} })
    .then((json) => {
      if (state.active && json.data) {
        state.active.viewers = json.data;
        renderPresence();
      }
    })
    .catch(() => {});
}
function leavePresence(sessionId) {
  const body = new Blob([JSON.stringify({ leave: true })], { type: "application/json" });
  if (!navigator.sendBeacon?.(`/api/conversas/${sessionId}/presence`, body)) {
    api(`/api/conversas/${sessionId}/presence`, { method: "POST", body: { leave: true } }).catch(() => {});
  }
}
setInterval(sendPresence, 20000);
document.addEventListener("visibilitychange", sendPresence);
addEventListener("pagehide", () => state.activeId && leavePresence(state.activeId));

// ── Tempo real (SSE) ─────────────────────────────────────────────────────
let reloadTimer = null;
const reloadSoon = () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadConversas, 300);
};

function onNewMessage({ message, session }) {
  if (!session?.phone) return;
  const current = sessionById(session.id);
  if (!current) return reloadSoon(); // cliente novo
  const fromClient = message.role === "user";
  patchSession(session.id, {
    lastMessage: message,
    updated_at: message.created_at,
    unanswered: fromClient ? (current.unanswered || 0) + 1 : 0,
    ...(session.contact_name ? { contact_name: session.contact_name } : {}),
  });
  if (state.activeId === session.id) {
    appendMessage(message);
    if (fromClient) reopenWindow(message.created_at);
  }
}

function onMessageUpdate({ message, sessionId }) {
  if (state.activeId === sessionId) updateMessage(message);
  const s = sessionById(sessionId);
  if (s?.lastMessage?.id === message.id) patchSession(sessionId, { lastMessage: { ...s.lastMessage, ...message } });
}

function connectStream() {
  const es = new EventSource("/api/conversas/stream");
  let dropped = false;
  const json = (handler) => (e) => handler(JSON.parse(e.data));
  es.onmessage = json(onNewMessage);
  es.addEventListener("status", json((d) => d.sessionId === state.activeId && updateMessage({ id: d.messageId, delivery_status: d.status, delivery_error: d.error, wa_message_id: d.waMessageId })));
  es.addEventListener("update", json(onMessageUpdate));
  es.addEventListener("session", json(({ session }) => (sessionById(session.id) ? patchSession(session.id, session) : session.phone && reloadSoon())));
  es.addEventListener("client", json(({ phone, tags }) => setTagsLocal(phone, tags)));
  es.addEventListener("presence", json(({ sessionId, viewers }) => {
    if (state.active && sessionId === state.activeId) {
      state.active.viewers = viewers;
      renderPresence();
    }
  }));
  es.onopen = () => {
    // Voltou depois de cair: recarrega para não perder o que chegou no meio.
    if (!dropped) return;
    dropped = false;
    loadConversas().then(() => state.activeId && select(state.activeId));
  };
  es.onerror = () => {
    dropped = true;
    // Fechado de vez (ex: sessão encerrada — 401): api() leva para o login.
    if (es.readyState === EventSource.CLOSED) api("/api/me").then(() => setTimeout(connectStream, 3000)).catch(() => {});
  };
}

// ── Início ───────────────────────────────────────────────────────────────
const boot = window.CONVERSAS_BOOT;
if (boot) {
  state.sessions = onlyWhatsApp(boot.conversations);
  state.team = boot.team || [];
}
initList();
connectStream();
if (boot) openFromDeepLink();
else loadConversas().then(openFromDeepLink);
