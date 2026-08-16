(function () {
  const tbody = document.getElementById("contatosTbody");
  const searchInput = document.getElementById("contatosSearch");
  let debounceTimer = null;

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("pt-BR");
  }

  async function loadContatos(search) {
    tbody.innerHTML = `<tr><td colspan="6" class="dash-empty">Carregando contatos...</td></tr>`;
    try {
      const url = search ? `/api/contatos?search=${encodeURIComponent(search)}` : "/api/contatos";
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      renderTable(json.data || []);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="dash-empty">Erro ao carregar contatos.</td></tr>`;
    }
  }

  function renderTable(clients) {
    if (clients.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="dash-empty">Nenhum contato encontrado ainda. Os dados aparecem aqui conforme os clientes forem informando nome, e-mail, endereço ou data de nascimento pelo WhatsApp.</td></tr>`;
      return;
    }

    tbody.innerHTML = clients.map((c) => `
      <tr>
        <td>${escapeHtml(c.name) || "—"}</td>
        <td>${escapeHtml(c.phone)}</td>
        <td>${escapeHtml(c.email) || "—"}</td>
        <td>${escapeHtml(c.address) || "—"}</td>
        <td>${formatDate(c.birth_date)}</td>
        <td>${formatDate(c.updated_at)}</td>
      </tr>
    `).join("");
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadContatos(searchInput.value.trim()), 300);
  });

  loadContatos();
})();
