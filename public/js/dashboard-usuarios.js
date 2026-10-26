// Tela de Usuários (somente admin): lista, cria, edita, desativa/reativa,
// redefine senha e exclui (só quem não tem histórico — o servidor confere).
(function () {
  const { escapeHtml, avatarHtml, api, me } = window.Dash;
  const ROLE_LABELS = { admin: "Administrador", atendente: "Atendente" };

  const tbody = document.getElementById("usuariosTbody");
  const userOverlay = document.getElementById("usuarioOverlay");
  const userForm = document.getElementById("usuarioForm");
  const userTitle = document.getElementById("usuarioTitulo");
  const userSave = document.getElementById("usuarioSalvar");
  const userError = document.getElementById("usuarioErro");
  const nameInput = document.getElementById("usuarioNome");
  const emailInput = document.getElementById("usuarioEmail");
  const roleInput = document.getElementById("usuarioPapel");
  const passwordWrap = document.getElementById("usuarioSenhaWrap");
  const passwordInput = document.getElementById("usuarioSenha");

  const pwOverlay = document.getElementById("senhaOverlay");
  const pwForm = document.getElementById("senhaForm");
  const pwWho = document.getElementById("senhaQuem");
  const pwInput = document.getElementById("senhaNova");
  const pwSave = document.getElementById("senhaSalvar");
  const pwError = document.getElementById("senhaErro");

  let users = [];
  let editing = null; // usuário em edição (null = criando)
  let resetting = null; // usuário cuja senha está sendo redefinida

  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
  }

  function render() {
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="dash-empty">Nenhum usuário cadastrado ainda. Use "+ Novo usuário".</td></tr>`;
      return;
    }
    tbody.innerHTML = users
      .map((u) => {
        const isMe = me && u.id === me.id;
        const roleBadge = u.role === "admin"
          ? `<span class="badge badge-gold">${ROLE_LABELS.admin}</span>`
          : `<span class="badge badge-gray">${ROLE_LABELS.atendente}</span>`;
        const statusBadge = u.active
          ? `<span class="badge badge-green">Ativo</span>`
          : `<span class="badge badge-gray">Desativado</span>`;
        // Ninguém se desativa nem se exclui pela tela (o servidor também barra).
        const toggle = isMe
          ? ""
          : u.active
            ? `<button type="button" class="btn btn-danger btn-sm" data-action="deactivate" data-id="${u.id}">Desativar</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-action="activate" data-id="${u.id}">Reativar</button>`;
        const del = isMe ? "" : `<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="${u.id}" title="Excluir (só sem histórico)">Excluir</button>`;
        return `<tr class="${u.active ? "" : "is-inactive"}">
          <td><span class="usuario-nome">${avatarHtml(u)}<span>${escapeHtml(u.name)}${isMe ? ` <span class="usuario-voce">(você)</span>` : ""}</span></span></td>
          <td>${escapeHtml(u.email)}</td>
          <td>${roleBadge}</td>
          <td>${statusBadge}</td>
          <td class="usuario-data">${fmtDate(u.created_at)}</td>
          <td><div class="usuario-acoes">
            <button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="${u.id}">Editar</button>
            <button type="button" class="btn btn-secondary btn-sm" data-action="password" data-id="${u.id}">Redefinir senha</button>
            ${toggle}${del}
          </div></td>
        </tr>`;
      })
      .join("");
  }

  async function load() {
    try {
      const json = await api("/api/users");
      users = json.data || [];
      render();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="dash-empty">Erro ao carregar usuários: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // ── Modal criar/editar ──
  function openUserModal(user) {
    editing = user || null;
    userForm.reset();
    userError.style.display = "none";
    userTitle.textContent = user ? "Editar usuário" : "Novo usuário";
    userSave.textContent = user ? "Salvar" : "Criar usuário";
    nameInput.value = user ? user.name : "";
    emailInput.value = user ? user.email : "";
    roleInput.value = user ? user.role : "atendente";
    // O próprio admin não muda o próprio papel (evita se trancar de fora).
    roleInput.disabled = Boolean(user && me && user.id === me.id);
    passwordWrap.style.display = user ? "none" : "";
    passwordInput.required = !user;
    userOverlay.classList.add("open");
    nameInput.focus();
  }

  function showError(el, message) {
    el.textContent = message;
    el.style.display = "block";
  }

  userForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { name: nameInput.value.trim(), email: emailInput.value.trim() };
    if (!roleInput.disabled) body.role = roleInput.value;
    if (!editing) {
      if (passwordInput.value.length < 8) return showError(userError, "A senha precisa ter pelo menos 8 caracteres.");
      body.password = passwordInput.value;
    }

    userSave.disabled = true;
    try {
      if (editing) {
        await api(`/api/users/${editing.id}`, { method: "PATCH", body });
      } else {
        await api("/api/users", { method: "POST", body });
      }
      closeAll();
      await load();
    } catch (err) {
      showError(userError, err.message);
    } finally {
      userSave.disabled = false;
    }
  });

  // ── Modal redefinir senha ──
  function openPasswordModal(user) {
    resetting = user;
    pwForm.reset();
    pwError.style.display = "none";
    pwWho.textContent = `${user.name} · ${user.email}`;
    pwOverlay.classList.add("open");
    pwInput.focus();
  }

  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pwInput.value.length < 8) return showError(pwError, "A senha precisa ter pelo menos 8 caracteres.");
    pwSave.disabled = true;
    try {
      await api(`/api/users/${resetting.id}/password`, { method: "POST", body: { password: pwInput.value } });
      closeAll();
      alert(`Senha de ${resetting.name} redefinida. Ela foi desconectada de todos os dispositivos.`);
    } catch (err) {
      showError(pwError, err.message);
    } finally {
      pwSave.disabled = false;
    }
  });

  function closeAll() {
    userOverlay.classList.remove("open");
    pwOverlay.classList.remove("open");
  }

  [userOverlay, pwOverlay].forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) closeAll();
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });

  // ── Ações da tabela ──
  async function setActive(user, active) {
    const question = active
      ? `Reativar ${user.name}? A pessoa volta a conseguir entrar no painel.`
      : `Desativar ${user.name}? A pessoa é desconectada na hora e não consegue mais entrar. O histórico dela é mantido.`;
    if (!confirm(question)) return;
    try {
      await api(`/api/users/${user.id}`, { method: "PATCH", body: { active } });
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(user) {
    if (!confirm(`Excluir ${user.name} definitivamente? Só é possível se a pessoa nunca tiver registrado nada no sistema.`)) return;
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const user = users.find((u) => u.id === btn.dataset.id);
    if (!user) return;
    const action = btn.dataset.action;
    if (action === "edit") openUserModal(user);
    else if (action === "password") openPasswordModal(user);
    else if (action === "deactivate") setActive(user, false);
    else if (action === "activate") setActive(user, true);
    else if (action === "delete") remove(user);
  });

  document.getElementById("btnNovoUsuario").addEventListener("click", () => openUserModal(null));

  load();
})();
