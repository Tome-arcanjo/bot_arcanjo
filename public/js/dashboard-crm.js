(function () {
  const COLUMNS = [
    "Novo caso", "Em análise", "Documentos pendentes", "Processo iniciado",
    "Petição em elaboração", "Petição protocolada", "Aguardando manifestação",
    "Aguardando audiência", "Aguardando decisão", "Recurso", "Finalizado", "Arquivado",
  ];

  const board = document.getElementById("crmBoard");
  const callAlert = document.getElementById("crmCallAlert");
  let cases = [];

  function tagClass(tag) {
    if (tag === "Crítico") return "badge-red";
    if (tag === "Alta") return "badge-orange";
    if (tag === "Baixa") return "badge-green";
    return "badge-gold";
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    const i = cases.findIndex((x) => x.id === updated.id);
    if (i !== -1) cases[i] = updated;
    renderBoard();
  }

  function warnIfClientNotNotified(json, verb) {
    if (json.clientNotified === false) {
      alert(
        "Ligação " + verb + ", mas NÃO foi possível avisar o cliente pelo WhatsApp " +
        "(ele pode estar fora da janela de 24h da Meta). Avise-o manualmente."
      );
    }
  }

  async function callRequest(url, method, body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || "Falha na requisição");
    return json;
  }

  async function completeCall(c) {
    try {
      const json = await callRequest("/api/crm/cases/" + c.id + "/call/complete", "POST");
      replaceCase(json.data);
    } catch (e) {
      alert(e.message || "Não foi possível concluir a ligação.");
    }
  }

  async function cancelCall(c) {
    const label = c.client_name || c.phone;
    if (!confirm("Cancelar a ligação com \"" + label + "\"?\nO cliente será avisado pelo WhatsApp.")) return;
    try {
      const json = await callRequest("/api/crm/cases/" + c.id + "/call", "DELETE");
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
      const json = await callRequest("/api/crm/cases/" + callModalCase.id + "/call", "PUT", {
        scheduledAt: picked.toISOString(),
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

  // O tempo passa sozinho: um card "Ligação Pendente" vira "atrasada" sem
  // ninguém mexer. Reavalia a cada 30s e só redesenha se algo mudou — e
  // nunca no meio de um arrastar, senão o card sendo arrastado some.
  let isDragging = false;
  let lastOverdueSignature = "";
  setInterval(() => {
    if (isDragging) return;
    const signature = cases.filter(isCallOverdue).map((c) => c.id).join(",");
    if (signature !== lastOverdueSignature) renderBoard();
  }, 30000);

  async function loadCases() {
    try {
      const res = await fetch("/api/crm/cases");
      const json = await res.json();
      if (json.success) {
        cases = json.data || [];
        renderBoard();
      } else {
        board.innerHTML = `<p class="dash-empty">Erro ao carregar casos: ${escapeHtml(json.error)}</p>`;
      }
    } catch (e) {
      board.innerHTML = `<p class="dash-empty">Não foi possível carregar o CRM. Tente atualizar a página.</p>`;
    }
  }

  function renderBoard() {
    board.innerHTML = "";
    lastOverdueSignature = cases.filter(isCallOverdue).map((c) => c.id).join(",");
    updateCallAlert();

    COLUMNS.forEach((status) => {
      const col = document.createElement("div");
      col.className = "crm-column";
      col.dataset.status = status;

      const colCases = cases.filter((c) => c.status === status);

      col.innerHTML = `
        <div class="crm-column-header">
          <h3>${escapeHtml(status)}</h3>
          <span class="crm-column-count">${colCases.length}</span>
        </div>
      `;

      colCases.forEach((c) => {
        const card = document.createElement("div");
        card.className = "crm-card";
        card.draggable = true;
        card.dataset.id = c.id;
        card.title = "Ver conversa com esse cliente";
        card.innerHTML = `
          <button type="button" class="crm-card-delete" draggable="false" title="Excluir caso">✕</button>
          <div class="crm-card-title">${escapeHtml(c.client_name || "Sem nome")}</div>
          <div class="crm-card-phone">${escapeHtml(c.phone)}</div>
          ${c.summary ? `<div class="crm-card-summary">${escapeHtml(c.summary)}</div>` : ""}
          <div class="crm-card-tags">
            <span class="badge ${tagClass(c.urgency_tag)}">${escapeHtml(c.urgency_tag || "Normal")}</span>
            ${c.area_tag ? `<span class="badge badge-gray">${escapeHtml(c.area_tag)}</span>` : ""}
          </div>
          ${callBlockHtml(c)}
        `;

        // Distingue "arrastei o card" de "cliquei no card": um drag real não
        // deve navegar pra Conversas quando soltar.
        let dragOccurred = false;

        card.addEventListener("dragstart", (e) => {
          dragOccurred = true;
          isDragging = true;
          card.classList.add("dragging");
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => {
          card.classList.remove("dragging");
          isDragging = false;
          setTimeout(() => { dragOccurred = false; }, 0);
        });

        card.addEventListener("click", () => {
          if (dragOccurred) return;
          goToConversation(c.phone);
        });

        const deleteBtn = card.querySelector(".crm-card-delete");
        deleteBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeCase(c.id, c.client_name || c.phone);
        });

        card.querySelectorAll("[data-call-action]").forEach((btn) => {
          btn.addEventListener("mousedown", (e) => e.stopPropagation());
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleCallAction(btn.dataset.callAction, c);
          });
        });

        col.appendChild(card);
      });

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
        const newStatus = col.dataset.status;
        await moveCase(caseId, newStatus);
      });

      board.appendChild(col);
    });
  }

  // Leva pra tela de Conversas já com a conversa desse telefone aberta —
  // funciona como um "router por id" simples via query string, resolvido
  // do lado de dashboard-conversas.js.
  function goToConversation(phone) {
    if (!phone) return;
    window.location.href = "/dashboard/conversas?phone=" + encodeURIComponent(phone);
  }

  async function moveCase(caseId, newStatus) {
    const target = cases.find((c) => c.id === caseId);
    if (!target || target.status === newStatus) return;

    // Atualiza otimisticamente na tela, sem esperar a resposta do servidor,
    // pra sensação de arrastar ficar instantânea.
    const previousStatus = target.status;
    target.status = newStatus;
    renderBoard();

    try {
      const res = await fetch(`/api/crm/cases/${caseId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Falha ao atualizar status");
    } catch (e) {
      // Desfaz se a chamada falhar.
      target.status = previousStatus;
      renderBoard();
      alert("Não foi possível mover o caso. Tente novamente.");
    }
  }

  async function removeCase(caseId, label) {
    const confirmed = confirm(`Excluir o caso de "${label}"? Essa ação não pode ser desfeita.`);
    if (!confirmed) return;

    // Remove otimisticamente da tela; se a chamada falhar, coloca de volta.
    const index = cases.findIndex((c) => c.id === caseId);
    if (index === -1) return;
    const [removed] = cases.splice(index, 1);
    renderBoard();

    try {
      const res = await fetch(`/api/crm/cases/${caseId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Falha ao excluir");
    } catch (e) {
      cases.splice(index, 0, removed);
      renderBoard();
      alert("Não foi possível excluir o caso. Tente novamente.");
    }
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
        const res = await fetch("/api/crm/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            clientName: inputNome.value.trim(),
            summary: inputResumo.value.trim(),
          }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Erro ao criar caso");

        cases.unshift(json.data);
        renderBoard();
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

  loadCases();
})();
