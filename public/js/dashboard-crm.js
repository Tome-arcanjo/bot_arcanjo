(function () {
  const COLUMNS = [
    "Novo caso", "Em análise", "Documentos pendentes", "Processo iniciado",
    "Petição em elaboração", "Petição protocolada", "Aguardando manifestação",
    "Aguardando audiência", "Aguardando decisão", "Recurso", "Finalizado", "Arquivado",
  ];

  const board = document.getElementById("crmBoard");
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
        card.innerHTML = `
          <button type="button" class="crm-card-delete" draggable="false" title="Excluir caso">✕</button>
          <div class="crm-card-title">${escapeHtml(c.client_name || "Sem nome")}</div>
          <div class="crm-card-phone">${escapeHtml(c.phone)}</div>
          ${c.summary ? `<div class="crm-card-summary">${escapeHtml(c.summary)}</div>` : ""}
          <div class="crm-card-tags">
            <span class="badge ${tagClass(c.urgency_tag)}">${escapeHtml(c.urgency_tag || "Normal")}</span>
            ${c.area_tag ? `<span class="badge badge-gray">${escapeHtml(c.area_tag)}</span>` : ""}
          </div>
        `;

        card.addEventListener("dragstart", (e) => {
          card.classList.add("dragging");
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));

        const deleteBtn = card.querySelector(".crm-card-delete");
        deleteBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeCase(c.id, c.client_name || c.phone);
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
