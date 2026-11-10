/**
 * Coluna da esquerda: abas (Chats / Pendentes / Contatos), busca, ordenação,
 * filtro por etiqueta e a lista de conversas.
 *
 *  - Chats: conversas com uma pessoa atendendo (IA pausada).
 *  - Pendentes: a IA está respondendo e ninguém assumiu — é a fila, por
 *    padrão quem espera há mais tempo primeiro (sessions.queue_since).
 *  - Contatos: todos os clientes (em atendimento, na fila ou encerrados),
 *    em ordem alfabética por padrão.
 */
import {
  state, emit, prefs, escapeHtml, icon, statusOf, lastActivity, waitingSince, summaryHtml,
  userById, isMe, firstName, onlyDigits, fmtTime, fmtDay, fmtWait,
} from "./store.js";

const { contactName, contactAvatarHtml, avatarHtml, tagsHtml, tagById, formatPhone } = window.Dash;

const listEl = document.getElementById("conversasList");
const tabsEl = document.getElementById("convTabs");
const searchEl = document.getElementById("convSearch");
const sortEl = document.getElementById("convSort");
const tagFilterEl = document.getElementById("convTagFilter");

// Rótulos curtos: o select divide a linha com o filtro de etiquetas.
const SORTS = {
  chats: [["recent", "Mais recentes"], ["oldest", "Menos recentes"], ["mine", "Só os meus"]],
  pendentes: [["wait-desc", "Maior espera"], ["wait-asc", "Menor espera"], ["recent", "Mais recentes"], ["oldest", "Menos recentes"]],
  contatos: [["name", "Nome (A–Z)"], ["recent", "Mais recentes"], ["oldest", "Menos recentes"]],
};

// Que conversas cada aba mostra.
const IN_TAB = {
  chats: (s) => statusOf(s) === "atendimento",
  pendentes: (s) => statusOf(s) === "fila",
  contatos: () => true,
};

let search = "";
let tagFilter = "";
const sortOf = (tab) => {
  const saved = prefs.get(`sort:${tab}`, null);
  return SORTS[tab].some(([v]) => v === saved) ? saved : SORTS[tab][0][0];
};

const byDate = (pick, dir) => (a, b) => dir * String(pick(a)).localeCompare(String(pick(b)));
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const SORTERS = {
  recent: byDate(lastActivity, -1),
  mine: byDate(lastActivity, -1),
  oldest: byDate(lastActivity, 1),
  "wait-desc": byDate(waitingSince, 1), // espera mais antiga = esperando há mais tempo
  "wait-asc": byDate(waitingSince, -1),
  name: (a, b) => collator.compare(contactName(a), contactName(b)),
};

function matches(s) {
  if (tagFilter && !(s.client_tags || []).includes(tagFilter)) return false;
  if (!search) return true;
  const q = search.toLowerCase();
  const digits = onlyDigits(search);
  const tagLabels = (s.client_tags || []).map((id) => tagById(id)?.label || "").join(" ").toLowerCase();
  return (
    contactName(s).toLowerCase().includes(q) ||
    (s.client_name || "").toLowerCase().includes(q) ||
    tagLabels.includes(q) ||
    Boolean(digits && onlyDigits(s.phone).includes(digits))
  );
}

/** Conversas da aba, já filtradas e ordenadas. */
export function visibleSessions(tab = state.tab) {
  const sort = sortOf(tab);
  return state.sessions
    .filter((s) => IN_TAB[tab](s) && matches(s) && (sort !== "mine" || isMe(s.handler_user_id)))
    .sort(SORTERS[sort]);
}

function previewHtml(s) {
  const m = s.lastMessage;
  if (!m) return "Sem mensagens";
  const who = m.role === "human" ? (isMe(m.sender_user_id) ? "Você" : firstName(userById(m.sender_user_id)?.name || "Equipe")) : m.role === "assistant" ? "IA" : "";
  return (who ? `${escapeHtml(who)}: ` : "") + summaryHtml(m);
}

function whenText(iso) {
  if (!iso) return "";
  const day = fmtDay(iso);
  return day === "Hoje" ? fmtTime(iso) : day;
}

function handlerBadge(s) {
  if (!s.ai_paused) return `<span class="conversa-item-ia" title="A IA está respondendo">IA</span>`;
  const user = userById(s.handler_user_id) || { id: s.handler_user_id, name: s.handler_user_id ? "?" : "Equipe" };
  return `<span class="conversa-item-handler" title="Atendimento: ${escapeHtml(user.name)}">${avatarHtml(user, { small: true })}</span>`;
}

const waitHtml = (since) => `${icon("clock", "icon-inline")} ${fmtWait(since)}`;

function waitBadge(s) {
  if (statusOf(s) !== "fila") return "";
  const since = waitingSince(s);
  const min = (Date.now() - Date.parse(since)) / 60000;
  const level = min >= 60 ? " is-late" : min >= 15 ? " is-warn" : "";
  return `<span class="conversa-wait${level}" data-wait="${escapeHtml(since)}" title="Esperando atendimento humano">${waitHtml(since)}</span>`;
}

// Na aba Contatos, cada cliente mostra a situação do atendimento.
function stateBadge(s) {
  const status = statusOf(s);
  if (status === "atendimento") {
    const name = isMe(s.handler_user_id) ? "você" : firstName(userById(s.handler_user_id)?.name || "equipe");
    return `<span class="conversa-state is-active">Em atendimento · ${escapeHtml(name)}</span>`;
  }
  return status === "fila" ? `<span class="conversa-state is-queue">Na fila</span>` : `<span class="conversa-state">Encerrado</span>`;
}

function itemHtml(s, position) {
  const contatos = state.tab === "contatos";
  const unread = s.unanswered > 0 && s.id !== state.activeId ? `<span class="conversa-unread" title="Mensagens do cliente sem resposta">${s.unanswered}</span>` : "";
  const queuePos = state.tab === "pendentes" && sortOf("pendentes") === "wait-desc" ? `<span class="conversa-queue-pos" title="Posição na fila">${position}º</span>` : "";
  const second = contatos ? `<div class="conversa-item-preview">${escapeHtml(formatPhone(s.phone))}</div>${stateBadge(s)}` : `<div class="conversa-item-preview">${previewHtml(s)}</div>${waitBadge(s)}${unread}${queuePos}${handlerBadge(s)}`;
  return `
    <button type="button" class="conversa-item${s.id === state.activeId ? " active" : ""}" role="listitem"
      data-id="${escapeHtml(s.id)}" data-phone="${escapeHtml(s.phone || "")}" title="${escapeHtml(formatPhone(s.phone))}">
      ${contactAvatarHtml(s, { large: true })}
      <div class="conversa-item-body">
        <div class="conversa-item-top">
          <div class="conversa-item-title">${escapeHtml(contactName(s))}</div>
          <span class="conversa-item-time">${escapeHtml(whenText(lastActivity(s)))}</span>
        </div>
        <div class="conversa-item-bottom">${second}</div>
        ${(s.client_tags || []).length ? `<div class="conversa-item-tags">${tagsHtml(s.client_tags, { max: 2 })}</div>` : ""}
      </div>
    </button>`;
}

/** Itens da lista; em Contatos (A–Z) com separador por letra, como na agenda do celular. */
function listHtml(list) {
  if (!(state.tab === "contatos" && sortOf("contatos") === "name")) return list.map((s, i) => itemHtml(s, i + 1)).join("");
  let letter = null;
  return list
    .map((s, i) => {
      const first = contactName(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").charAt(0).toUpperCase();
      const current = /[A-Z]/.test(first) ? first : "#";
      const sep = current !== letter ? `<div class="conv-letter">${current}</div>` : "";
      letter = current;
      return sep + itemHtml(s, i + 1);
    })
    .join("");
}

const EMPTY = {
  chats: "Nenhuma conversa em atendimento. Assuma um cliente em <strong>Pendentes</strong>.",
  pendentes: "Ninguém esperando atendimento.",
  contatos: "Nenhum contato ainda. Eles aparecem aqui quando o cliente escreve no WhatsApp.",
};

export function renderList() {
  // Contadores das abas (sem busca/filtro: é o tamanho real de cada fila).
  tabsEl.querySelectorAll("[data-tab]").forEach((btn) => {
    const tab = btn.dataset.tab;
    btn.classList.toggle("active", tab === state.tab);
    btn.setAttribute("aria-selected", tab === state.tab ? "true" : "false");
    const count = state.sessions.filter(IN_TAB[tab]).length;
    btn.querySelector(".conv-tab-count").textContent = tab === "contatos" || !count ? "" : count;
  });

  const list = visibleSessions();
  listEl.innerHTML = list.length
    ? listHtml(list)
    : `<p class="dash-empty">${search || tagFilter ? "Nada encontrado com esse filtro." : EMPTY[state.tab]}</p>`;

  // Título da aba do navegador: mensagens sem resposta nos meus chats, ou quantos esperam na fila.
  const waiting = state.sessions.filter(IN_TAB.pendentes).length;
  const mine = state.sessions.filter((s) => s.ai_paused && isMe(s.handler_user_id) && s.unanswered > 0).length;
  const badge = mine || waiting;
  document.title = `${badge ? `(${badge}) ` : ""}Conversas — Miguel Arcanjo Advocacia`;
}

function renderSortOptions() {
  const current = sortOf(state.tab);
  sortEl.innerHTML = SORTS[state.tab].map(([v, label]) => `<option value="${v}"${v === current ? " selected" : ""}>${label}</option>`).join("");
}

export function setTab(tab) {
  if (!SORTS[tab]) return;
  state.tab = tab;
  prefs.set("tab", tab);
  renderSortOptions();
  renderList();
}

export function initList() {
  tagFilterEl.innerHTML =
    `<option value="">Todas as etiquetas</option>` +
    (window.Dash.tags || []).map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join("");

  // Aba inicial: a última usada; na primeira vez, Chats se a pessoa já atende alguém, senão a fila.
  const saved = prefs.get("tab", null);
  state.tab = SORTS[saved] ? saved : state.sessions.some((s) => s.ai_paused && isMe(s.handler_user_id)) ? "chats" : "pendentes";

  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (btn) setTab(btn.dataset.tab);
  });
  sortEl.addEventListener("change", () => {
    prefs.set(`sort:${state.tab}`, sortEl.value);
    renderList();
  });
  tagFilterEl.addEventListener("change", () => {
    tagFilter = tagFilterEl.value;
    renderList();
  });
  searchEl.addEventListener("input", () => {
    search = searchEl.value.trim();
    renderList();
  });
  listEl.addEventListener("click", (e) => {
    const item = e.target.closest(".conversa-item");
    if (item) emit("select", item.dataset.id);
  });

  // O tempo de espera envelhece sozinho.
  setInterval(() => {
    listEl.querySelectorAll("[data-wait]").forEach((el) => (el.innerHTML = waitHtml(el.dataset.wait)));
  }, 30000);

  renderSortOptions();
  renderList();
}

