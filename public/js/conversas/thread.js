/**
 * Conversa aberta: cabeçalho, mensagens (com anexos, citações e reações),
 * aviso da janela de 24 h, presença e o menu de cada mensagem (responder,
 * reagir, copiar, encaminhar, editar, apagar, baixar).
 */
import {
  state, emit, on, me, api, escapeHtml, icon, isMe, isAdmin, firstName, userName, activeSession, statusOf,
  messageById, messageSummary, summaryHtml, authorName, quoteAuthor, mediaUrl, formatText, fmtTime, fmtDay, fmtSize,
  withTakeover, modal, sessionById, patchSession,
} from "./store.js";

const { contactName, contactAvatarHtml, formatPhone, tagsHtml } = window.Dash;

const el = (id) => document.getElementById(id);
const threadEl = el("conversasThread");
const headerEl = el("threadHeader");
const statusEl = el("threadStatus");
const presenceEl = el("threadPresence");
const windowEl = el("threadWindow");
const composer = el("threadComposer");
const composerInput = el("composerInput");
const composerSend = el("composerSend");
const composerHint = el("composerHint");
const menuEl = el("msgMenu");
const btn = {
  assumir: el("btnAssumir"),
  devolver: el("btnDevolver"),
  transferir: el("btnTransferir"),
  encerrar: el("btnEncerrar"),
};

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
let windowTimer = null;

// ── Cabeçalho ────────────────────────────────────────────────────────────
export function renderHeader() {
  const s = activeSession();
  if (!s) return;
  headerEl.hidden = false;
  el("threadAvatar").innerHTML = contactAvatarHtml(s, { large: true });
  el("threadTitle").textContent = contactName(s);
  const parts = [escapeHtml(formatPhone(s.phone))];
  if (s.contact_name && s.client_name && s.client_name !== s.contact_name) parts.push(`Cadastro: ${escapeHtml(s.client_name)}`);
  if (isAdmin()) parts.push(`<a href="/dashboard/crm" class="thread-link">Ver no CRM</a>`);
  const tags = tagsHtml(s.client_tags, { max: 3 });
  el("threadSub").innerHTML = parts.join(" · ") + (tags ? ` <span class="thread-tags">${tags}</span>` : "");

  const handler = userName(s.handler_user_id);
  if (s.ai_paused) {
    statusEl.className = "badge badge-green";
    statusEl.textContent = `Atendimento humano · ${isMe(s.handler_user_id) ? "você" : handler || "equipe"}`;
  } else if (statusOf(s) === "encerrado") {
    statusEl.className = "badge badge-gray";
    statusEl.textContent = "Encerrado";
  } else {
    statusEl.className = "badge badge-gold";
    statusEl.textContent = "IA respondendo";
  }

  const mine = s.ai_paused && isMe(s.handler_user_id);
  btn.assumir.hidden = mine;
  btn.assumir.textContent = s.ai_paused ? "Assumir de " + firstName(handler || "outra pessoa") : "Assumir";
  btn.devolver.hidden = !s.ai_paused;
  btn.encerrar.hidden = statusOf(s) === "encerrado";
}

export function renderPresence() {
  if (!state.active) return;
  const isSelf = (v) => Boolean(me) && (me.id ? v.id === me.id : !v.id && v.name === me.name);
  const names = (state.active.viewers || []).filter((v) => !isSelf(v)).map((v) => v.name);
  presenceEl.hidden = names.length === 0;
  if (!names.length) return;
  const who = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " e " + names.at(-1);
  presenceEl.innerHTML = `${icon("eye", "icon-inline")} ${escapeHtml(who)} também ${names.length === 1 ? "está" : "estão"} com esta conversa aberta.`;
}

// ── Janela de 24 h e caixa de resposta ───────────────────────────────────
export function renderWindow() {
  if (!state.active) return;
  clearTimeout(windowTimer);
  const w = state.active.window;
  composer.hidden = false;
  composer.classList.toggle("is-locked", !w.open);
  composerInput.disabled = !w.open;
  composerSend.disabled = !w.open;

  if (w.open) {
    windowEl.hidden = true;
    const ms = Date.parse(w.closesAt) - Date.now(); // fecha sozinho quando passar das 24 h
    if (ms > 0 && ms < 2 ** 31) windowTimer = setTimeout(() => ((state.active.window.open = false), renderWindow()), ms + 500);
  } else {
    const since = w.lastClientMessageAt ? ` (última mensagem dele em ${new Date(w.lastClientMessageAt).toLocaleString("pt-BR")})` : "";
    windowEl.innerHTML = `
      <div><strong>Fora da janela de 24 h.</strong> O cliente não fala com a gente há mais de 24 h${escapeHtml(since)},
      e o WhatsApp só permite retomar a conversa com um modelo de mensagem aprovado pela Meta.</div>
      ${w.templateConfigured
        ? `<button type="button" class="btn btn-secondary btn-sm" id="btnTemplate">Enviar modelo de retomada</button>`
        : `<div class="thread-window-note">Nenhum modelo configurado no servidor (WHATSAPP_TEMPLATE_REENGAGE).</div>`}`;
    windowEl.hidden = false;
    el("btnTemplate")?.addEventListener("click", sendTemplate);
  }

  const s = activeSession();
  const sendingNote = state.active.sending === "off"
    ? "Envio pelo WhatsApp desligado no servidor: as mensagens ficam salvas como não enviadas."
    : state.active.sending === "simulated" ? "Modo simulado: nada é enviado de verdade pelo WhatsApp." : "";
  const windowNote = w.open && w.closesAt
    ? `Janela de 24 h aberta até ${new Date(w.closesAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`
    : "";
  const takeNote = w.open && s && !(s.ai_paused && isMe(s.handler_user_id)) ? "Ao enviar, você assume a conversa e a IA para." : "";
  composerHint.textContent = [takeNote, windowNote, sendingNote].filter(Boolean).join(" ");
  composerHint.classList.toggle("is-warning", state.active.sending !== "on");
}

/** O cliente escreveu: a janela de 24 h abre de novo. */
export function reopenWindow(createdAt) {
  if (!state.active) return;
  state.active.window = {
    ...state.active.window,
    open: true,
    lastClientMessageAt: createdAt,
    closesAt: new Date(Date.parse(createdAt) + 864e5).toISOString(),
  };
  renderWindow();
}

// ── Mensagens ────────────────────────────────────────────────────────────
function statusHtml(m) {
  if (m.role === "user" || !m.delivery_status) return "";
  const simulated = String(m.wa_message_id || "").startsWith("sim-") ? " (simulado)" : "";
  switch (m.delivery_status) {
    case "pending": return `<span class="msg-status is-pending">${icon("clock")} Enviando…</span>`;
    case "sent": return `<span class="msg-status" title="Enviada${simulated}">${icon("check")} Enviada${simulated}</span>`;
    case "delivered": return `<span class="msg-status" title="Entregue">${icon("check-check")} Entregue</span>`;
    case "read": return `<span class="msg-status is-read" title="Lida">${icon("check-check")} Lida</span>`;
    case "failed":
      return `<span class="msg-status is-failed">Não enviada${m.delivery_error ? ": " + escapeHtml(m.delivery_error) : ""}</span>
        <button type="button" class="msg-retry" data-retry="${escapeHtml(m.id)}">Tentar de novo</button>`;
    default: return "";
  }
}

function mediaHtml(m) {
  const media = m.media;
  const kind = m.message_type;
  if (!media?.path) {
    const why = media?.error ? `: ${escapeHtml(media.error)}` : "";
    return kind === "text" || kind === "template" ? "" : `<div class="msg-media-missing">${summaryHtml({ ...m, media: null })} indisponível${why}</div>`;
  }
  const url = mediaUrl(m);
  switch (kind) {
    case "image": return `<a href="${url}" target="_blank" rel="noopener" class="msg-image-link"><img class="msg-image" src="${url}" alt="Imagem" loading="lazy" /></a>`;
    case "sticker": return `<img class="msg-sticker" src="${url}" alt="Figurinha" loading="lazy" />`;
    case "audio": return `<audio class="msg-audio" controls preload="none" src="${url}"></audio>`;
    case "video": return `<video class="msg-video" controls preload="metadata" src="${url}"></video>`;
    default:
      return `<a class="msg-doc" href="${mediaUrl(m, true)}" download>
        <span class="msg-doc-icon">${icon("file")}</span>
        <span class="msg-doc-info"><span class="msg-doc-name">${escapeHtml(media.name || "Documento")}</span><span class="msg-doc-size">${escapeHtml(fmtSize(media.size))}</span></span>
        <span class="msg-doc-dl">${icon("download")}</span>
      </a>`;
  }
}

function bodyText(m) {
  if (m.media || m.message_type === "image" || m.message_type === "sticker") return m.media?.caption || "";
  return m.content || "";
}

function quoteHtml(m) {
  if (!m.reply_to_id) return "";
  const q = messageById(m.reply_to_id);
  const text = q ? messageSummary(q) : "Mensagem anterior";
  return `<button type="button" class="msg-quote" data-jump="${escapeHtml(m.reply_to_id)}">
    <span class="msg-quote-who">${escapeHtml(q ? quoteAuthor(q) : "")}</span>
    <span class="msg-quote-text">${q ? summaryHtml(q) : escapeHtml(text)}</span>
  </button>`;
}

function reactionsHtml(m) {
  const list = Array.isArray(m.reactions) ? m.reactions : [];
  if (!list.length) return "";
  return `<div class="msg-reactions">${list
    .map((r) => `<span class="msg-reaction" title="${escapeHtml(r.from === "client" ? r.name || "Cliente" : r.name || "Equipe")}">${escapeHtml(r.emoji)}</span>`)
    .join("")}</div>`;
}

export function messageHtml(m) {
  const cls = m.role === "user" ? "user" : m.role === "human" ? "human" : "assistant";
  const flags = [m.delivery_status === "failed" && "is-failed", m.deleted_at && "is-deleted", m.message_type === "sticker" && !m.deleted_at && "is-sticker"]
    .filter(Boolean).map((c) => " " + c).join("");
  const author = authorName(m);
  const time = `<div class="thread-msg-time">${m.edited_at && !m.deleted_at ? `<span class="msg-edited">editada</span> ` : ""}${escapeHtml(fmtTime(m.created_at))} ${m.deleted_at ? "" : statusHtml(m)}</div>`;

  if (m.deleted_at) {
    return `<div class="thread-msg ${cls}${flags}" data-id="${escapeHtml(m.id)}">${author ? `<div class="thread-msg-author">${escapeHtml(author)}</div>` : ""}
      <div class="msg-deleted">${icon("ban", "icon-inline")} Mensagem apagada${m.deleted_by_name ? ` por ${escapeHtml(m.deleted_by_name)}` : ""} — só no painel; o cliente ainda vê no WhatsApp dele.</div>${time}</div>`;
  }
  const text = bodyText(m);
  return `<div class="thread-msg ${cls}${flags}" data-id="${escapeHtml(m.id)}">
    <button type="button" class="msg-more" data-menu="${escapeHtml(m.id)}" aria-label="Opções da mensagem" title="Opções">${icon("chevron-down")}</button>
    ${m.forwarded ? `<div class="msg-forwarded">${icon("forward", "icon-inline")} Encaminhada</div>` : ""}
    ${author ? `<div class="thread-msg-author">${escapeHtml(author)}</div>` : ""}
    ${quoteHtml(m)}${mediaHtml(m)}
    ${text ? `<div class="msg-text">${formatText(text)}</div>` : ""}
    ${time}${reactionsHtml(m)}
  </div>`;
}

const daySeparator = (iso) => `<div class="thread-day" data-day="${escapeHtml(fmtDay(iso))}"><span>${escapeHtml(fmtDay(iso))}</span></div>`;

export function renderThread() {
  if (state.messages.length === 0) {
    threadEl.innerHTML = `<p class="dash-empty">Essa conversa ainda não tem mensagens.</p>`;
    return;
  }
  let lastDay = null;
  threadEl.innerHTML = state.messages
    .map((m) => {
      const day = fmtDay(m.created_at);
      const sep = day !== lastDay ? daySeparator(m.created_at) : "";
      lastDay = day;
      return sep + messageHtml(m);
    })
    .join("");
  threadEl.scrollTop = threadEl.scrollHeight;
}

/** Mensagem nova na conversa aberta (do SSE ou da resposta do envio). */
export function appendMessage(m) {
  if (messageById(m.id)) return updateMessage(m);
  state.messages.push(m);
  if (threadEl.querySelector(".dash-empty")) threadEl.innerHTML = "";
  const nearBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 160;
  const lastDay = [...threadEl.querySelectorAll(".thread-day")].at(-1)?.dataset.day;
  const html = (lastDay !== fmtDay(m.created_at) ? daySeparator(m.created_at) : "") + messageHtml(m);
  threadEl.insertAdjacentHTML("beforeend", html);
  if (nearBottom || m.role !== "user") threadEl.scrollTop = threadEl.scrollHeight;
}

/** Troca uma mensagem já na tela (status, reação, edição, exclusão). */
export function updateMessage(m) {
  const i = state.messages.findIndex((x) => x.id === m.id);
  if (i === -1) return;
  state.messages[i] = { ...state.messages[i], ...m };
  const node = threadEl.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
  if (node) node.outerHTML = messageHtml(state.messages[i]);
}

// ── Menu da mensagem ─────────────────────────────────────────────────────
let menuMessageId = null;

const canReact = (m) => Boolean(m.wa_message_id) && state.active?.window.open;
const canManage = (m) => m.role === "human" && (isAdmin() || isMe(m.sender_user_id));

function openMenu(messageId, anchor) {
  const m = messageById(messageId);
  if (!m || m.deleted_at) return;
  menuMessageId = messageId;
  const mine = (m.reactions || []).find((r) => r.from === "team")?.emoji;
  const items = [
    ["reply", "reply", "Responder"],
    (m.content || m.media?.caption) && ["copy", "copy", "Copiar texto"],
    m.message_type !== "template" && (m.media ? m.media.path : true) && ["forward", "forward", "Encaminhar"],
    m.media?.path && ["download", "download", "Baixar"],
    canManage(m) && m.message_type === "text" && ["edit", "pencil", "Editar"],
    canManage(m) && ["delete", "trash", "Apagar"],
  ].filter(Boolean);
  menuEl.innerHTML = `
    <div class="msg-menu-reactions${canReact(m) ? "" : " is-disabled"}" title="${canReact(m) ? "Reagir" : "Reações só valem para mensagens entregues e dentro da janela de 24 h"}">
      ${QUICK_REACTIONS.map((e) => `<button type="button" data-react="${e}" class="${e === mine ? "active" : ""}" ${canReact(m) ? "" : "disabled"}>${e}</button>`).join("")}
      ${mine ? `<button type="button" data-react="" class="msg-react-clear" title="Tirar reação" ${canReact(m) ? "" : "disabled"}>${icon("x")}</button>` : ""}
    </div>
    ${items.map(([action, ic, label]) => `<button type="button" class="msg-menu-item${action === "delete" ? " is-danger" : ""}" data-action="${action}" role="menuitem">${icon(ic)}${label}</button>`).join("")}`;
  menuEl.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
  menuEl.style.top = (r.bottom + h + 8 > window.innerHeight ? r.top - h - 4 : r.bottom + 4) + "px";
}

export function closeMenu() {
  menuEl.hidden = true;
  menuMessageId = null;
}

async function react(m, emoji) {
  try {
    const json = await api(`/api/conversas/messages/${encodeURIComponent(m.id)}/react`, { method: "POST", body: { emoji } });
    updateMessage(json.data);
  } catch (err) {
    alert(err.message || "Não foi possível reagir.");
  }
}

async function removeMessage(m) {
  if (!confirm("Apagar esta mensagem?\n\nO WhatsApp não permite apagar uma mensagem já entregue: ela some só aqui no painel (fica registrado quem apagou) e o cliente continua vendo.")) return;
  try {
    updateMessage((await api(`/api/conversas/messages/${encodeURIComponent(m.id)}`, { method: "DELETE" })).data);
  } catch (err) {
    alert(err.message || "Não foi possível apagar.");
  }
}

// Editar: falhou → troca o texto; já enviada → manda uma correção citando a original.
const editModal = modal("editOverlay");
let editing = null;
function openEdit(m) {
  editing = m;
  el("editInput").value = m.content;
  el("editHint").textContent = m.delivery_status === "failed"
    ? "Esta mensagem não chegou ao cliente: o texto é trocado e você pode reenviar."
    : "O WhatsApp não permite editar uma mensagem já entregue. Vamos enviar uma correção (\"Correção: …\") respondendo a ela, e a original fica marcada como editada.";
  el("editErro").style.display = "none";
  editModal.open();
  el("editInput").focus();
}
el("editSave").addEventListener("click", async () => {
  if (!editing) return;
  const content = el("editInput").value.trim();
  try {
    const json = await api(`/api/conversas/messages/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: { content } });
    updateMessage(json.data);
    if (json.correction) appendMessage(json.correction);
    editModal.close();
  } catch (err) {
    el("editErro").textContent = err.message;
    el("editErro").style.display = "block";
  }
});

function handleMenuAction(action, m) {
  closeMenu();
  switch (action) {
    case "reply": return emit("reply", m);
    case "copy": return navigator.clipboard?.writeText(m.media?.caption || m.content || "");
    case "forward": return emit("forward", m);
    case "download": return window.open(mediaUrl(m, true), "_blank");
    case "edit": return openEdit(m);
    case "delete": return removeMessage(m);
  }
}

menuEl.addEventListener("click", (e) => {
  const m = messageById(menuMessageId);
  if (!m) return closeMenu();
  const reaction = e.target.closest("[data-react]");
  if (reaction && !reaction.disabled) {
    closeMenu();
    return react(m, reaction.dataset.react);
  }
  const item = e.target.closest("[data-action]");
  if (item) handleMenuAction(item.dataset.action, m);
});
document.addEventListener("click", (e) => {
  if (!menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest("[data-menu]")) closeMenu();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
threadEl.addEventListener("scroll", closeMenu, { passive: true });

threadEl.addEventListener("click", (e) => {
  const more = e.target.closest("[data-menu]");
  if (more) return menuMessageId === more.dataset.menu ? closeMenu() : openMenu(more.dataset.menu, more);
  const retryBtn = e.target.closest("[data-retry]");
  if (retryBtn) return retry(retryBtn.dataset.retry);
  const quote = e.target.closest("[data-jump]");
  if (quote) {
    const target = threadEl.querySelector(`.thread-msg[data-id="${CSS.escape(quote.dataset.jump)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.classList.add("is-flash");
    setTimeout(() => target?.classList.remove("is-flash"), 1600);
  }
});
// Botão direito na mensagem abre o mesmo menu (como no WhatsApp Web).
threadEl.addEventListener("contextmenu", (e) => {
  const bubble = e.target.closest(".thread-msg");
  if (!bubble || e.target.closest("a, audio, video")) return;
  e.preventDefault();
  openMenu(bubble.dataset.id, bubble.querySelector(".msg-more") || bubble);
});
// Duplo clique responde.
threadEl.addEventListener("dblclick", (e) => {
  const m = messageById(e.target.closest(".thread-msg")?.dataset.id);
  if (m && !m.deleted_at) emit("reply", m);
});

async function retry(messageId) {
  try {
    await api(`/api/conversas/messages/${encodeURIComponent(messageId)}/retry`, { method: "POST" });
  } catch (err) {
    alert(err.message || "Não foi possível reenviar a mensagem.");
  }
}

// ── Ações do cabeçalho ───────────────────────────────────────────────────
async function sendTemplate() {
  const id = state.activeId;
  if (!confirm(`Enviar o modelo de retomada "${state.active.window.templateName}" para este cliente?`)) return;
  try {
    const json = await withTakeover((force) => api(`/api/conversas/${id}/template`, { method: "POST", body: { force } }), "Enviar o modelo");
    if (json?.data && state.activeId === id) appendMessage(json.data);
  } catch (err) {
    alert(err.message || "Não foi possível enviar o modelo.");
  }
}

/** POST de uma ação da conversa que devolve a sessão atualizada. */
export async function sessionAction(path, what, body = {}) {
  const id = state.activeId;
  try {
    const json = await withTakeover((force) => api(`/api/conversas/${id}/${path}`, { method: "POST", body: { ...body, force } }), what);
    if (json?.data) patchSession(id, json.data);
    return json?.data || null;
  } catch (err) {
    alert(err.message || "Não foi possível concluir a ação.");
    return null;
  }
}

btn.assumir.addEventListener("click", async () => {
  if (await sessionAction("assume", "Assumir")) emit("handled");
});
btn.devolver.addEventListener("click", () => {
  if (confirm("Devolver esta conversa à IA? Ela volta a responder o cliente automaticamente e o cliente volta para a fila de Pendentes.")) sessionAction("release", "Devolver");
});
btn.encerrar.addEventListener("click", () => emit("close-request"));
btn.transferir.addEventListener("click", () => emit("transfer-request"));

on("active", () => {
  renderHeader();
  renderWindow();
});

export { sessionById };
