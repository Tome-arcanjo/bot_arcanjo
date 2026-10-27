(function () {
  const { escapeHtml, avatarHtml, timeAgo, api, me } = window.Dash;
  // Colunas vindas do servidor (src/constants/crm.js) — a mesma lista que valida o status.
  const COLUMNS = window.CRM_COLUMNS || [];
  const isAdmin = Boolean(me && me.role === "admin");

  const board = document.getElementById("crmBoard");
  const callAlert = document.getElementById("crmCallAlert");
  const filtersEl = document.getElementById("crmFilters");
  const liveEl = document.getElementById("crmLive");
  const toastsEl = document.getElementById("crmToasts");
  const assignMenu = document.getElementById("crmAssignMenu");

  let cases = [];
  let team = []; // [{ id, name, role, active }]

  // ── Filtro (Todos / Meus casos / Sem responsável), lembrado por navegador ──
  const FILTER_KEY = "crm:filter";
  let filter = "all";
  try {
    filter = localStorage.getItem(FILTER_KEY) || "all";
  } catch {
    // localStorage indisponível (modo privado etc.)
  }
  if (!me || !me.id) {
    // Acesso de emergência não tem casos "meus".
    filtersEl.querySelector('[data-filter="mine"]').hidden = true;
    if (filter === "mine") filter = "all";
  }

  function passesFilter(c) {
    if (filter === "mine") return Boolean(me && me.id) && c.assigned_to === me.id;
    if (filter === "unassigned") return !c.assigned_to;
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

  function tagClass(tag) {
    if (tag === "Crítico") return "badge-red";
    if (tag === "Alta") return "badge-orange";
    if (tag === "Baixa") return "badge-green";
    return "badge-gold";
  }

  function userById(id) {
    return id ? team.find((u) => u.id === id) || null : null;
  }

  function caseLabel(c) {
    return (c && (c.client_name || c.phone)) || "caso";
  }

  // Ação feita por mim (nesta ou em outra aba)? Então não precisa de aviso.
  function isMine(actor) {
    if (!actor || !me) return false;
    return me.id ? actor.id === me.id : !actor.id && actor.name === me.name;
  }

  // ── Ligação com o advogado ─────────────────────────────────────────────
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function fmtDuration(ms) {
    const totalMin = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return m + " min";
    return m === 0 ? h + "h" : h + "h " + m + "min";
  }

  function isCallOverdue(c) {
    return c.call_status === "pendente" && c.call_scheduled_at && new Date(c.call_scheduled_at).getTime() <= Date.now();
  }

  // Etiqueta + horário + botões de ação da ligação, dentro do card.
  function callBlockHtml(c) {
    if (c.call_status === "pendente" && c.call_scheduled_at) {
      const overdue = isCallOverdue(c);
      const timeText = overdue
        ? "Atrasada há " + fmtDuration(Date.now() - new Date(c.call_scheduled_at).getTime()) + " · " + fmtDateTime(c.call_scheduled_at)
        : fmtDateTime(c.call_scheduled_at);
      return `
        <div class="crm-card-call">
          <span class="badge ${overdue ? "badge-red" : "badge-blue"}">Ligação Pendente</span>
          <span class="crm-call-time ${overdue ? "crm-call-late" : ""}">${escapeHtml(timeText)}</span>
        </div>
        <div class="crm-card-actions">
          <button type="button" class="crm-call-btn" data-call-action="complete" draggable="false">Concluir</button>
          <button type="button" class="crm-call-btn" data-call-action="reschedule" draggable="false">Remarcar</button>
          <button type="button" class="crm-call-btn crm-call-btn-danger" data-call-action="cancel" draggable="false">Cancelar</button>
        </div>`;
    }

    if (c.call_status === "concluida") {
      return `
        <div class="crm-card-call">
          <span class="badge badge-green">Ligação Concluída</span>
          <span class="crm-call-time">${escapeHtml(fmtDateTime(c.call_completed_at || c.call_scheduled_at))}</span>
        </div>
        <div class="crm-card-actions">
          <button type="button" class="crm-call-btn" data-call-action="schedule" draggable="false">📞 Nova ligação</button>
        </div>`;
    }

    return `
      <div class="crm-card-actions">
        <button type="button" class="crm-call-btn" data-call-action="schedule" draggable="false">📞 Agendar ligação</button>
      </div>`;
  }

  function updateCallAlert() {
    const late = cases.filter(isCallOverdue).length;
    if (late === 0) {
      callAlert.style.display = "none";
      return;
    }
    callAlert.textContent = late === 1
      ? "⚠ 1 ligação está atrasada."
      : "⚠ " + late + " ligações estão atrasadas.";
    callAlert.style.display = "block";
  }

  function replaceCase(updated) {
    if (!updated) return;
    upsertCase(updated);
    // Faz o alerta de "ligação atrasada" (dashboard-call-alerts.js) sumir/atualizar na hora.
    window.dispatchEvent(new Event("call-alerts:refresh"));
  }

  function warnIfClientNotNotified(json, verb) {
    if (json.clientNotified === false) {
      alert(
        "Ligação " + verb + ", mas NÃO foi possível avisar o cliente pelo WhatsApp " +
        "(ele pode estar fora da janela de 24h da Meta). Avise-o manualmente."
      );
    }
  }

  async function completeCall(c) {
    try {
      const json = await api("/api/crm/cases/" + c.id + "/call/complete", { method: "POST" });
      replaceCase(json.data);
    } catch (e) {
      alert(e.message || "Não foi possível concluir a ligação.");
    }
  }

  async function cancelCall(c) {
    const label = c.client_name || c.phone;
    if (!confirm("Cancelar a ligação com \"" + label + "\"?\nO cliente será avisado pelo WhatsApp.")) return;
    try {
      const json = await api("/api/crm/cases/" + c.id + "/call", { method: "DELETE" });
      replaceCase(json.data);
      warnIfClientNotNotified(json, "cancelada");
    } catch (e) {
      alert(e.message || "Não foi possível cancelar a ligação.");
    }
  }

  function handleCallAction(action, c) {
    if (action === "complete") return completeCall(c);
    if (action === "cancel") return cancelCall(c);
    return openCallModal(c, action === "reschedule");
  }

  // ── Modal "Agendar / remarcar ligação" ────────────────────────────────
  const callOverlay = document.getElementById("ligacaoOverlay");
  const callTitle = document.getElementById("ligacaoTitulo");
  const callClient = document.getElementById("ligacaoCliente");
  const callInput = document.getElementById("ligacaoDataHora");
  const callNotice = document.getElementById("ligacaoAviso");
  const callError = document.getElementById("ligacaoErro");
  const callSave = document.getElementById("ligacaoSalvar");
  let callModalCase = null;

  // <input type="datetime-local"> trabalha com "AAAA-MM-DDTHH:mm" no horário local.
  function toLocalInputValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function openCallModal(c, isReschedule) {
    callModalCase = c;
    callTitle.textContent = isReschedule ? "Remarcar ligação" : "Agendar ligação";
    callSave.textContent = isReschedule ? "Remarcar" : "Agendar";
    callClient.textContent = (c.client_name || "Sem nome") + " · " + c.phone;
    callNotice.style.display = isReschedule ? "block" : "none";
    callError.style.display = "none";
    callInput.min = toLocalInputValue(new Date());
    callInput.value = isReschedule && c.call_scheduled_at ? toLocalInputValue(new Date(c.call_scheduled_at)) : "";
    callOverlay.classList.add("open");
    callInput.focus();
  }

  function closeCallModal() {
    callOverlay.classList.remove("open");
    callModalCase = null;
  }

  document.getElementById("ligacaoClose").addEventListener("click", closeCallModal);
  document.getElementById("ligacaoCancelar").addEventListener("click", closeCallModal);
  callOverlay.addEventListener("click", (e) => {
    if (e.target === callOverlay) closeCallModal();
  });

  callSave.addEventListener("click", async () => {
    if (!callModalCase) return;
    const picked = callInput.value ? new Date(callInput.value) : null;
    if (!picked || Number.isNaN(picked.getTime())) {
      callError.textContent = "Informe a data e a hora da ligação.";
      callError.style.display = "block";
      return;
    }
    if (picked.getTime() <= Date.now()) {
      callError.textContent = "O horário da ligação precisa estar no futuro.";
      callError.style.display = "block";
      return;
    }

    const label = callSave.textContent;
    callSave.disabled = true;
    callSave.textContent = "Salvando...";
    try {
      const json = await api("/api/crm/cases/" + callModalCase.id + "/call", {
        method: "PUT",
        body: { scheduledAt: picked.toISOString() },
      });
      replaceCase(json.data);
      closeCallModal();
      warnIfClientNotNotified(json, "remarcada");
    } catch (e) {
      callError.textContent = e.message || "Não foi possível salvar a ligação.";
      callError.style.display = "block";
    } finally {
      callSave.disabled = false;
      callSave.textContent = label;
    }
  });

  // ── Desenho do quadro ──────────────────────────────────────────────────
  // O quadro inteiro só é redesenhado na carga, ao trocar o filtro e quando
  // uma ligação passa a atrasar. Mudanças (minhas ou de outra pessoa) trocam
  // só o card afetado — e nunca no meio de um arrastar (ficam numa fila).
  let isDragging = false;
  let lastOverdueSignature = "";

  function byUpdatedDesc(a, b) {
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  }

  function columnEl(status) {
    return [...board.querySelectorAll(".crm-column")].find((col) => col.dataset.status === status) || null;
  }

  function cardEl(id) {
    return [...board.querySelectorAll(".crm-card")].find((card) => card.dataset.id === id) || null;
  }

  function updateCounts() {
    board.querySelectorAll(".crm-column").forEach((col) => {
      col.querySelector(".crm-column-count").textContent = col.querySelectorAll(".crm-card").length;
    });
  }

  function movedText(c) {
    if (!c.status_changed_by_name || !c.status_changed_at) return "Histórico";
    return `movido por ${c.status_changed_by_name.split(/\s+/)[0]} · ${timeAgo(c.status_changed_at)}`;
  }

  function assigneeHtml(c) {
    const user = userById(c.assigned_to);
    if (!c.assigned_to) {
      return `${avatarHtml(null, { small: true })}<span class="crm-assign-name is-empty">Sem responsável</span>`;
    }
    const name = user ? user.name : "Usuário removido";
    const inactive = user && !user.active ? " (desativado)" : "";
    return `${avatarHtml(user || { id: c.assigned_to, name }, { small: true })}<span class="crm-assign-name">${escapeHtml(name.split(/\s+/)[0] + inactive)}</span>`;
  }

  function buildCard(c) {
    const card = document.createElement("div");
    card.className = "crm-card";
    card.draggable = true;
    card.dataset.id = c.id;
    card.title = "Ver conversa com esse cliente";
    card.innerHTML = `
      ${isAdmin ? `<button type="button" class="crm-card-delete" draggable="false" title="Excluir caso">✕</button>` : ""}
      <div class="crm-card-title">${escapeHtml(c.client_name || "Sem nome")}</div>
      <div class="crm-card-phone">${escapeHtml(c.phone)}</div>
      ${c.summary ? `<div class="crm-card-summary">${escapeHtml(c.summary)}</div>` : ""}
      <div class="crm-card-tags">
        <span class="badge ${tagClass(c.urgency_tag)}">${escapeHtml(c.urgency_tag || "Normal")}</span>
        ${c.area_tag ? `<span class="badge badge-gray">${escapeHtml(c.area_tag)}</span>` : ""}
      </div>
      ${callBlockHtml(c)}
      <div class="crm-card-footer">
        <button type="button" class="crm-assign-btn" data-assign draggable="false" title="Responsável — clique para atribuir ou transferir">${assigneeHtml(c)}</button>
        <button type="button" class="crm-history-btn" data-history draggable="false" title="Ver histórico do caso" ${c.status_changed_at ? `data-moved-at="${escapeHtml(c.status_changed_at)}"` : ""}>${escapeHtml(movedText(c))}</button>
      </div>
    `;

    // Distingue "arrastei o card" de "cliquei no card": um drag real não
    // deve navegar pra Conversas quando soltar.
    let dragOccurred = false;

    card.addEventListener("dragstart", (e) => {
      dragOccurred = true;
      isDragging = true;
      closeAssignMenu();
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", c.id);
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
      goToConversation(c.phone);
    });

    // Botões dentro do card: não iniciam arraste nem abrem a conversa.
    card.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
    });

    const deleteBtn = card.querySelector(".crm-card-delete");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeCase(c.id, c.client_name || c.phone);
      });
    }

    card.querySelectorAll("[data-call-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleCallAction(btn.dataset.callAction, currentCase(c.id) || c);
      });
    });

    card.querySelector("[data-assign]").addEventListener("click", (e) => {
      e.stopPropagation();
      openAssignMenu(currentCase(c.id) || c, e.currentTarget);
    });

    card.querySelector("[data-history]").addEventListener("click", (e) => {
      e.stopPropagation();
      openHistory(currentCase(c.id) || c);
    });

    return card;
  }

  function currentCase(id) {
    return cases.find((x) => x.id === id) || null;
  }

  function buildColumn(status) {
    const col = document.createElement("div");
    col.className = "crm-column";
    col.dataset.status = status;
    col.innerHTML = `
      <div class="crm-column-header">
        <h3>${escapeHtml(status)}</h3>
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
      const caseId = e.dataTransfer.getData("text/plain");
      await moveCase(caseId, col.dataset.status);
    });
    return col;
  }

  function renderBoard() {
    board.innerHTML = "";
    lastOverdueSignature = cases.filter(isCallOverdue).map((c) => c.id).join(",");
    updateCallAlert();

    COLUMNS.forEach((status) => {
      const col = buildColumn(status);
      cases
        .filter((c) => c.status === status && passesFilter(c))
        .sort(byUpdatedDesc)
        .forEach((c) => col.appendChild(buildCard(c)));
      board.appendChild(col);
    });
    updateCounts();
  }

  /**
   * Insere ou substitui um caso, mexendo só no card dele. O card atualizado
   * vai para o topo da coluna (o quadro é ordenado por última atualização).
   */
  function upsertCase(c, opts) {
    const i = cases.findIndex((x) => x.id === c.id);
    if (i === -1) cases.push(c);
    else cases[i] = c;

    const old = cardEl(c.id);
    if (old) old.remove();
    const col = columnEl(c.status);
    if (col && passesFilter(c)) {
      const card = buildCard(c);
      if (opts && opts.highlight) card.classList.add("is-remote");
      col.querySelector(".crm-column-header").after(card);
    }
    updateCounts();
    updateCallAlert();
  }

  function removeCaseLocal(id) {
    cases = cases.filter((c) => c.id !== id);
    const old = cardEl(id);
    if (old) old.remove();
    updateCounts();
    updateCallAlert();
  }

  // O tempo passa sozinho: um card "Ligação Pendente" vira "atrasada" sem
  // ninguém mexer. Reavalia a cada 30s e só redesenha se algo mudou — e
  // nunca no meio de um arrastar, senão o card sendo arrastado some.
  setInterval(() => {
    if (isDragging) return;
    const signature = cases.filter(isCallOverdue).map((c) => c.id).join(",");
    if (signature !== lastOverdueSignature) renderBoard();
  }, 30000);

  // "movido por Ana · há 5 min" envelhece sozinho.
  setInterval(() => {
    board.querySelectorAll("[data-moved-at]").forEach((btn) => {
      const c = currentCase(btn.closest(".crm-card").dataset.id);
      if (c) btn.textContent = movedText(c);
    });
  }, 60000);

  async function loadCases() {
    try {
      const [casesJson, teamJson] = await Promise.all([api("/api/crm/cases"), api("/api/crm/users")]);
      cases = casesJson.data || [];
      team = teamJson.data || [];
      renderBoard();
    } catch (e) {
      board.innerHTML = `<p class="dash-empty">Não foi possível carregar o CRM: ${escapeHtml(e.message)}. Tente atualizar a página.</p>`;
    }
  }

  // Leva pra tela de Conversas já com a conversa desse telefone aberta —
  // funciona como um "router por id" simples via query string, resolvido
  // do lado de dashboard-conversas.js.
  function goToConversation(phone) {
    if (!phone) return;
    window.location.href = "/dashboard/conversas?phone=" + encodeURIComponent(phone);
  }

  async function moveCase(caseId, newStatus) {
    const target = currentCase(caseId);
    if (!target || target.status === newStatus) return;

    // Atualiza otimisticamente na tela, sem esperar a resposta do servidor,
    // pra sensação de arrastar ficar instantânea.
    const previous = target;
    upsertCase(Object.assign({}, target, {
      status: newStatus,
      updated_at: new Date().toISOString(),
      status_changed_by_name: me ? me.name : null,
      status_changed_at: new Date().toISOString(),
    }));

    try {
      const json = await api(`/api/crm/cases/${caseId}/status`, { method: "PATCH", body: { status: newStatus } });
      if (json.data) upsertCase(json.data);
    } catch (e) {
      // Desfaz se a chamada falhar (ex: alguém excluiu o caso nesse meio-tempo).
      if (/não encontrado/i.test(e.message)) removeCaseLocal(caseId);
      else upsertCase(previous);
      alert(e.message || "Não foi possível mover o caso. Tente novamente.");
    }
  }

  async function removeCase(caseId, label) {
    const confirmed = confirm(`Excluir o caso de "${label}"? Essa ação não pode ser desfeita.`);
    if (!confirmed) return;

    // Remove otimisticamente da tela; se a chamada falhar, coloca de volta.
    const removed = currentCase(caseId);
    if (!removed) return;
    removeCaseLocal(caseId);

    try {
      await api(`/api/crm/cases/${caseId}`, { method: "DELETE" });
    } catch (e) {
      upsertCase(removed);
      alert(e.message || "Não foi possível excluir o caso. Tente novamente.");
    }
  }

  // ── Responsável (atribuir / transferir) ────────────────────────────────
  let assignMenuCase = null;

  function openAssignMenu(c, anchor) {
    assignMenuCase = c;
    const active = team.filter((u) => u.active);
    const items = active
      .map((u) => `
        <button type="button" role="menuitem" class="crm-assign-option${u.id === c.assigned_to ? " is-current" : ""}" data-user-id="${escapeHtml(u.id)}">
          ${avatarHtml(u, { small: true })}<span>${escapeHtml(u.name)}${me && u.id === me.id ? " (você)" : ""}</span>
        </button>`)
      .join("");
    assignMenu.innerHTML = `
      <div class="crm-assign-title">Responsável</div>
      ${items || `<div class="crm-assign-empty">Nenhum usuário ativo. Cadastre a equipe em Usuários.</div>`}
      <div class="crm-assign-sep"></div>
      <button type="button" role="menuitem" class="crm-assign-option${!c.assigned_to ? " is-current" : ""}" data-user-id="">
        ${avatarHtml(null, { small: true })}<span>Sem responsável</span>
      </button>`;
    assignMenu.hidden = false;

    // Posiciona embaixo do botão, sem sair da tela.
    const rect = anchor.getBoundingClientRect();
    const menuRect = assignMenu.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
    const below = rect.bottom + 4;
    const top = below + menuRect.height > window.innerHeight ? rect.top - menuRect.height - 4 : below;
    assignMenu.style.left = Math.max(8, left) + "px";
    assignMenu.style.top = Math.max(8, top) + "px";
  }

  function closeAssignMenu() {
    assignMenu.hidden = true;
    assignMenuCase = null;
  }

  assignMenu.addEventListener("click", async (e) => {
    const option = e.target.closest("[data-user-id]");
    if (!option || !assignMenuCase) return;
    const c = assignMenuCase;
    const userId = option.dataset.userId || null;
    closeAssignMenu();
    if ((c.assigned_to || null) === userId) return;
    try {
      const json = await api(`/api/crm/cases/${c.id}/assign`, { method: "PATCH", body: { userId } });
      if (json.data) upsertCase(json.data);
    } catch (err) {
      alert(err.message || "Não foi possível atribuir o caso.");
    }
  });

  document.addEventListener("click", (e) => {
    if (!assignMenu.hidden && !assignMenu.contains(e.target)) closeAssignMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAssignMenu();
      closeHistory();
    }
  });
  board.addEventListener("scroll", closeAssignMenu);
  window.addEventListener("resize", closeAssignMenu);

  // ── Histórico do caso ──────────────────────────────────────────────────
  const historyOverlay = document.getElementById("historicoOverlay");
  const historyList = document.getElementById("historicoLista");
  const historyClient = document.getElementById("historicoCliente");

  function describeEvent(ev) {
    const from = ev.from_value ? escapeHtml(ev.from_value) : "";
    const to = ev.to_value ? escapeHtml(ev.to_value) : "";
    switch (ev.type) {
      case "created": return `criou o caso${to ? ` em <strong>${to}</strong>` : ""}`;
      case "moved": return `moveu de <strong>${from}</strong> para <strong>${to}</strong>`;
      case "assigned":
        if (!to) return `removeu o responsável${from ? ` (${from})` : ""}`;
        if (ev.to_value === ev.actor_name) return from ? `assumiu o caso (antes: ${from})` : "assumiu o caso";
        return from ? `transferiu de <strong>${from}</strong> para <strong>${to}</strong>` : `atribuiu a <strong>${to}</strong>`;
      case "tags": return `classificou: ${to}${from ? ` <span class="crm-history-was">(antes: ${from})</span>` : ""}`;
      case "call": return `ligação: ${to}`;
      case "deleted": return "excluiu o caso";
      case "ai_paused": return "assumiu a conversa (IA pausada)";
      case "ai_resumed": return "devolveu a conversa à IA";
      default: return escapeHtml(ev.type);
    }
  }

  async function openHistory(c) {
    historyClient.textContent = `${c.client_name || "Sem nome"} · ${c.phone}`;
    historyList.innerHTML = `<li class="crm-history-empty">Carregando...</li>`;
    historyOverlay.classList.add("open");
    try {
      const json = await api(`/api/crm/cases/${c.id}/events`);
      const events = json.data || [];
      historyList.innerHTML = events.length === 0
        ? `<li class="crm-history-empty">Nenhuma alteração registrada ainda.</li>`
        : events
          .map((ev) => `
            <li>
              ${avatarHtml({ id: ev.user_id, name: ev.actor_name || "?" }, { small: true })}
              <div>
                <div><strong>${escapeHtml(ev.actor_name || "Sistema")}</strong> ${describeEvent(ev)}</div>
                <div class="crm-history-time">${escapeHtml(new Date(ev.created_at).toLocaleString("pt-BR"))}</div>
              </div>
            </li>`)
          .join("");
    } catch (e) {
      historyList.innerHTML = `<li class="crm-history-empty">${escapeHtml(e.message)}</li>`;
    }
  }

  function closeHistory() {
    historyOverlay.classList.remove("open");
  }

  document.getElementById("historicoClose").addEventListener("click", closeHistory);
  historyOverlay.addEventListener("click", (e) => {
    if (e.target === historyOverlay) closeHistory();
  });

  // ── Tempo real (SSE /api/crm/stream) ───────────────────────────────────
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

  function eventToastHtml(ev, label) {
    const who = `<strong>${escapeHtml(ev.actor.name)}</strong>`;
    const what = `<strong>${escapeHtml(label)}</strong>`;
    switch (ev.type) {
      case "created": return `${who} criou o caso ${what}`;
      case "moved": return `${who} moveu ${what} para <strong>${escapeHtml(ev.to)}</strong>`;
      case "assigned":
        if (!ev.to) return `${who} tirou o responsável de ${what}`;
        if (ev.to === ev.actor.name) return `${who} assumiu ${what}`;
        return `${who} atribuiu ${what} a <strong>${escapeHtml(ev.to)}</strong>`;
      case "deleted": return `${who} excluiu o caso ${what}`;
      case "call": return `${who} · ligação de ${what}: ${escapeHtml(ev.to || "atualizada")}`;
      default: return null; // etiquetas: atualiza o card sem aviso (a IA classifica o tempo todo)
    }
  }

  function applyEvent(ev) {
    const mine = isMine(ev.actor);
    const before = currentCase(ev.caseId);
    if (ev.type === "deleted") {
      if (!before) return;
      removeCaseLocal(ev.caseId);
    } else if (ev.case) {
      upsertCase(ev.case, { highlight: !mine });
    }
    if (!mine) {
      const html = eventToastHtml(ev, caseLabel(ev.case || before));
      if (html) toast(html);
    }
    if (ev.type === "call") window.dispatchEvent(new Event("call-alerts:refresh"));
  }

  function flushPendingEvents() {
    while (pendingEvents.length && !isDragging) applyEvent(pendingEvents.shift());
  }

  function setLive(state) {
    liveEl.dataset.state = state;
    liveEl.textContent = state === "on" ? "Ao vivo" : state === "off" ? "Reconectando..." : "Conectando...";
  }

  function connectStream() {
    const es = new EventSource("/api/crm/stream");
    let dropped = false;
    es.addEventListener("crm", (msg) => {
      const ev = JSON.parse(msg.data);
      if (isDragging) pendingEvents.push(ev);
      else applyEvent(ev);
    });
    es.onopen = () => {
      setLive("on");
      // Voltou depois de cair: recarrega para não perder o que mudou no meio.
      if (dropped) {
        dropped = false;
        loadCases();
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

  // ── Modal "Novo caso" ────────────────────────────────────────────────
  const overlay = document.getElementById("novoCasoOverlay");
  const btnAbrir = document.getElementById("btnNovoCaso");
  const btnFechar = document.getElementById("novoCasoClose");
  const btnCancelar = document.getElementById("novoCasoCancelar");
  const btnSalvar = document.getElementById("novoCasoSalvar");
  const inputPhone = document.getElementById("novoCasoPhone");
  const inputNome = document.getElementById("novoCasoNome");
  const inputResumo = document.getElementById("novoCasoResumo");
  const erroEl = document.getElementById("novoCasoErro");

  function abrirModal() {
    inputPhone.value = "";
    inputNome.value = "";
    inputResumo.value = "";
    erroEl.style.display = "none";
    overlay.classList.add("open");
    inputPhone.focus();
  }

  function fecharModal() {
    overlay.classList.remove("open");
  }

  if (btnAbrir) btnAbrir.addEventListener("click", abrirModal);
  if (btnFechar) btnFechar.addEventListener("click", fecharModal);
  if (btnCancelar) btnCancelar.addEventListener("click", fecharModal);
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fecharModal();
    });
  }

  if (btnSalvar) {
    btnSalvar.addEventListener("click", async () => {
      const phone = inputPhone.value.trim();
      if (!phone) {
        erroEl.textContent = "Informe o telefone do cliente.";
        erroEl.style.display = "block";
        return;
      }

      btnSalvar.disabled = true;
      btnSalvar.textContent = "Criando...";

      try {
        const json = await api("/api/crm/cases", {
          method: "POST",
          body: {
            phone,
            clientName: inputNome.value.trim(),
            summary: inputResumo.value.trim(),
          },
        });
        upsertCase(json.data);
        fecharModal();
      } catch (e) {
        erroEl.textContent = e.message || "Não foi possível criar o caso.";
        erroEl.style.display = "block";
      } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = "Criar caso";
      }
    });
  }

  renderFilters();
  setLive("connecting");
  loadCases().then(connectStream);
})();
