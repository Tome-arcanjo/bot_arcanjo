(function () {
  const { escapeHtml, avatarHtml, contactAvatarHtml, contactName, formatPhone, tagsHtml, timeAgo, api, me } = window.Dash;
  // Colunas vindas do servidor (src/constants/atendimento.js) — a mesma lista que valida a etapa.
  const COLUMNS = window.ATENDIMENTO_COLUMNS || [];

  const board = document.getElementById("atBoard");
  const filtersEl = document.getElementById("atFilters");
  const searchEl = document.getElementById("atSearch");
  const liveEl = document.getElementById("atLive");
  const toastsEl = document.getElementById("atToasts");

  let sessions = []; // só conversas de WhatsApp (com telefone)
  let team = []; // [{ id, name, role, active }]
  let search = "";

  // ── Filtro (Todos / Meus atendimentos / Sem atendente), lembrado por navegador ──
  const FILTER_KEY = "atendimento:filter";
  let filter = "all";
  try {
    filter = localStorage.getItem(FILTER_KEY) || "all";
  } catch {
    // localStorage indisponível (modo privado etc.)
  }
  if (!me || !me.id) {
    // Acesso de emergência não tem atendimentos "meus".
    filtersEl.querySelector('[data-filter="mine"]').hidden = true;
    if (filter === "mine") filter = "all";
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function passesFilter(s) {
    const handled = s.ai_paused && s.handler_user_id;
    if (filter === "mine" && !(Boolean(me && me.id) && handled && s.handler_user_id === me.id)) return false;
    if (filter === "unassigned" && handled) return false;
    if (search) {
      const name = contactName(s).toLowerCase();
      const digits = onlyDigits(search);
      if (!name.includes(search.toLowerCase()) && !(digits && onlyDigits(s.phone).includes(digits))) return false;
    }
    return true;
  }

  function renderFilters() {
    filtersEl.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
      btn.setAttribute("aria-pressed", btn.dataset.filter === filter ? "true" : "false");
    });
  }

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn || btn.dataset.filter === filter) return;
    filter = btn.dataset.filter;
    try {
      localStorage.setItem(FILTER_KEY, filter);
    } catch {
      // ignora
    }
    renderFilters();
    renderBoard();
  });

  searchEl.addEventListener("input", () => {
    search = searchEl.value.trim();
    renderBoard();
  });

  function userById(id) {
    return id ? team.find((u) => u.id === id) || null : null;
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || name;
  }

  // Ação feita por mim (nesta ou em outra aba)? Então não precisa de aviso.
  function isMine(actor) {
    if (!actor || !me) return false;
    return me.id ? actor.id === me.id : !actor.id && actor.name === me.name;
  }

  function stageOf(s) {
    return COLUMNS.includes(s.board_stage) ? s.board_stage : COLUMNS[0];
  }

  function lastActivity(s) {
    return (s.lastMessage && s.lastMessage.created_at) || s.updated_at || s.created_at || "";
  }

  function byActivityDesc(a, b) {
    return String(lastActivity(b)).localeCompare(String(lastActivity(a)));
  }

  function previewText(m) {
    if (!m) return "Sem mensagens";
    if (m.role === "human") {
      const who = me && me.id && m.sender_user_id === me.id ? "Você" : firstName((userById(m.sender_user_id) || {}).name || "Equipe");
      return `${who}: ${m.content}`;
    }
    if (m.role === "assistant") return `IA: ${m.content}`;
    return m.content;
  }

  // ── Desenho do quadro ──────────────────────────────────────────────────
  // Como no CRM: o quadro inteiro só é redesenhado na carga e ao trocar o
  // filtro/busca. Mensagens e movimentações trocam só o card afetado — e
  // nunca no meio de um arrastar (ficam numa fila até soltar).
  let isDragging = false;

  function columnEl(stage) {
    return [...board.querySelectorAll(".crm-column")].find((col) => col.dataset.stage === stage) || null;
  }

  function cardEl(id) {
    return [...board.querySelectorAll(".at-card")].find((card) => card.dataset.id === id) || null;
  }

  function updateCounts() {
    board.querySelectorAll(".crm-column").forEach((col) => {
      col.querySelector(".crm-column-count").textContent = col.querySelectorAll(".at-card").length;
    });
  }

  function movedText(s) {
    if (!s.board_stage_changed_by_name || !s.board_stage_changed_at) return "";
    return `movido por ${firstName(s.board_stage_changed_by_name)} · ${timeAgo(s.board_stage_changed_at)}`;
  }

  function handlerHtml(s) {
    if (!s.ai_paused) return `<span class="at-ia" title="A IA está respondendo">IA</span><span class="at-handler-name is-muted">Robô</span>`;
    const user = userById(s.handler_user_id);
    const name = user ? user.name : s.handler_user_id ? "Usuário removido" : "Equipe";
    return `${avatarHtml({ id: s.handler_user_id, name }, { small: true })}<span class="at-handler-name">${escapeHtml(firstName(name))}</span>`;
  }

  function buildCard(s) {
    const card = document.createElement("div");
    card.className = "crm-card at-card";
    card.draggable = true;
    card.dataset.id = s.id;
    card.title = "Abrir a conversa com esse cliente";
    const name = contactName(s);
    const phone = formatPhone(s.phone);
    const activity = lastActivity(s);
    card.innerHTML = `
      <div class="at-card-head">
        ${contactAvatarHtml(s, { large: true })}
        <div class="at-card-who">
          <div class="at-card-name">${escapeHtml(name)}</div>
          ${name !== phone ? `<div class="crm-card-phone at-card-phone">${escapeHtml(phone)}</div>` : ""}
        </div>
        ${activity ? `<span class="at-card-time" data-at="${escapeHtml(activity)}">${escapeHtml(timeAgo(activity))}</span>` : ""}
      </div>
      <div class="at-card-preview">${escapeHtml(previewText(s.lastMessage))}</div>
      ${(s.client_tags || []).length ? `<div class="at-card-tags">${tagsHtml(s.client_tags, { max: 3 })}</div>` : ""}
      <div class="crm-card-footer">
        <span class="at-card-handler">${handlerHtml(s)}</span>
        <span class="at-card-moved" ${s.board_stage_changed_at ? `data-moved-at="${escapeHtml(s.board_stage_changed_at)}"` : ""}>${escapeHtml(movedText(s))}</span>
      </div>
    `;

    // Distingue "arrastei o card" de "cliquei no card": um drag real não
    // deve abrir a conversa quando soltar.
    let dragOccurred = false;

    card.addEventListener("dragstart", (e) => {
      dragOccurred = true;
      isDragging = true;
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", s.id);
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      isDragging = false;
      setTimeout(() => {
        dragOccurred = false;
        flushPendingEvents();
      }, 0);
    });

    card.addEventListener("click", () => {
      if (dragOccurred) return;
      window.location.href = "/dashboard/conversas?phone=" + encodeURIComponent(s.phone);
    });

    return card;
  }

  function current(id) {
    return sessions.find((x) => x.id === id) || null;
  }

  function buildColumn(stage) {
    const col = document.createElement("div");
    col.className = "crm-column";
    col.dataset.stage = stage;
    col.innerHTML = `
      <div class="crm-column-header">
        <h3>${escapeHtml(stage)}</h3>
        <span class="crm-column-count">0</span>
      </div>
    `;

    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      await moveStage(e.dataTransfer.getData("text/plain"), col.dataset.stage);
    });
    return col;
  }

  function renderBoard() {
    board.innerHTML = "";
    COLUMNS.forEach((stage) => {
      const col = buildColumn(stage);
      sessions
        .filter((s) => stageOf(s) === stage && passesFilter(s))
        .sort(byActivityDesc)
        .forEach((s) => col.appendChild(buildCard(s)));
      board.appendChild(col);
    });
    updateCounts();
  }

  /**
   * Insere ou atualiza uma conversa, mexendo só no card dela. O card vai para
   * a posição certa da coluna (ordenada pela última mensagem).
   */
  function upsertSession(s, opts) {
    const i = sessions.findIndex((x) => x.id === s.id);
    if (i === -1) sessions.push(s);
    else sessions[i] = s;

    const old = cardEl(s.id);
    if (old) old.remove();
    const col = columnEl(stageOf(s));
    if (col && passesFilter(s)) {
      const card = buildCard(s);
      if (opts && opts.highlight) card.classList.add("is-remote");
      const next = [...col.querySelectorAll(".at-card")].find((el) => {
        const other = current(el.dataset.id);
        return other && byActivityDesc(s, other) <= 0;
      });
      if (next) next.before(card);
      else col.appendChild(card);
    }
    updateCounts();
  }

  // "há 5 min" envelhece sozinho.
  setInterval(() => {
    board.querySelectorAll("[data-at]").forEach((el) => (el.textContent = timeAgo(el.dataset.at)));
    board.querySelectorAll("[data-moved-at]").forEach((el) => {
      const s = current(el.closest(".at-card").dataset.id);
      if (s) el.textContent = movedText(s);
    });
  }, 60000);

  // Dados que já vieram no HTML (montados no servidor); usados só na primeira carga.
  let boot = window.CONVERSAS_BOOT;

  async function loadBoard() {
    if (boot) {
      sessions = (boot.conversations || []).filter((s) => s.phone);
      team = boot.team || [];
      boot = null;
      return renderBoard();
    }
    try {
      const [convJson, teamJson] = await Promise.all([api("/api/conversas"), api("/api/crm/users")]);
      sessions = (convJson.data || []).filter((s) => s.phone);
      team = teamJson.data || [];
      renderBoard();
    } catch (e) {
      board.innerHTML = `<p class="dash-empty">Não foi possível carregar o quadro: ${escapeHtml(e.message)}. Tente atualizar a página.</p>`;
    }
  }

  async function moveStage(sessionId, stage) {
    const target = current(sessionId);
    if (!target || stageOf(target) === stage) return;

    // Atualiza otimisticamente, para o arrastar parecer instantâneo.
    const previous = target;
    upsertSession(Object.assign({}, target, {
      board_stage: stage,
      board_stage_changed_by: me ? me.id : null,
      board_stage_changed_by_name: me ? me.name : null,
      board_stage_changed_at: new Date().toISOString(),
    }));

    try {
      const json = await api(`/api/conversas/${sessionId}/stage`, { method: "PATCH", body: { stage } });
      if (json.data) upsertSession(Object.assign({}, current(sessionId), json.data));
    } catch (e) {
      upsertSession(previous);
      alert(e.message || "Não foi possível mover o cliente. Tente novamente.");
    }
  }

  // ── Tempo real (SSE /api/conversas/stream) ─────────────────────────────
  const pendingEvents = [];

  function toast(html) {
    const el = document.createElement("div");
    el.className = "crm-toast";
    el.innerHTML = html;
    toastsEl.appendChild(el);
    while (toastsEl.children.length > 3) toastsEl.firstElementChild.remove();
    setTimeout(() => el.classList.add("is-leaving"), 4500);
    setTimeout(() => el.remove(), 5000);
  }

  // Mensagem nova: atualiza a prévia e sobe o card (ou cria, se é cliente novo).
  function applyMessage({ message, session }) {
    if (!session || !session.phone) return;
    const before = current(session.id);
    const merged = Object.assign({}, before || session, { lastMessage: message });
    if (session.contact_name) merged.contact_name = session.contact_name;
    upsertSession(merged, { highlight: !before });
  }

  // Conversa alterada: etapa no quadro, IA pausada/retomada, nome do WhatsApp.
  function applySession({ session, actor }) {
    if (!session || !session.phone) return;
    const before = current(session.id);
    const moved = before && stageOf(before) !== stageOf(session);
    const mine = isMine(actor);
    upsertSession(Object.assign({}, before || {}, session), { highlight: moved && !mine });
    if (moved && !mine) {
      const label = `<strong>${escapeHtml(contactName(Object.assign({}, before, session)))}</strong>`;
      const to = `<strong>${escapeHtml(stageOf(session))}</strong>`;
      toast(actor && actor.id
        ? `<strong>${escapeHtml(actor.name)}</strong> moveu ${label} para ${to}`
        : `${label} escreveu de novo e voltou para ${to}`);
    }
  }

  // Etiquetas jurídicas do cliente mudaram (em Conversas ou em outra aba).
  function applyTags({ phone, tags }) {
    sessions.filter((s) => s.phone === phone).forEach((s) => upsertSession(Object.assign({}, s, { client_tags: tags })));
  }

  function applyEvent(ev) {
    if (ev.kind === "message") applyMessage(ev.data);
    else if (ev.kind === "client") applyTags(ev.data);
    else applySession(ev.data);
  }

  function enqueue(kind, data) {
    if (isDragging) pendingEvents.push({ kind, data });
    else applyEvent({ kind, data });
  }

  function flushPendingEvents() {
    while (pendingEvents.length && !isDragging) applyEvent(pendingEvents.shift());
  }

  function setLive(state) {
    liveEl.dataset.state = state;
    liveEl.textContent = state === "on" ? "Ao vivo" : state === "off" ? "Reconectando..." : "Conectando...";
  }

  function connectStream() {
    const es = new EventSource("/api/conversas/stream");
    let dropped = false;
    es.onmessage = (msg) => enqueue("message", JSON.parse(msg.data));
    es.addEventListener("session", (msg) => enqueue("session", JSON.parse(msg.data)));
    es.addEventListener("client", (msg) => enqueue("client", JSON.parse(msg.data)));
    es.onopen = () => {
      setLive("on");
      // Voltou depois de cair: recarrega para não perder o que mudou no meio.
      if (dropped) {
        dropped = false;
        loadBoard();
      }
    };
    es.onerror = () => {
      dropped = true;
      setLive("off");
      // Fechado de vez (ex: sessão encerrada — 401): api() leva para o login.
      if (es.readyState === EventSource.CLOSED) {
        api("/api/me").then(() => setTimeout(connectStream, 3000)).catch(() => {});
      }
    };
  }

  renderFilters();
  connectStream();
  loadBoard();
})();
