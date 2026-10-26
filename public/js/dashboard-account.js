// Modal "Minha conta" (aberto pelo nome do usuário no rodapé da sidebar):
// trocar a própria senha. A marcação vem de src/views/dashboardLayout.js.
(function () {
  const chip = document.getElementById("dashUserChip");
  const overlay = document.getElementById("accountOverlay");
  if (!chip || !overlay) return;

  const form = document.getElementById("accountForm");
  const errorEl = document.getElementById("accountError");
  const successEl = document.getElementById("accountSuccess");
  const saveBtn = document.getElementById("accountSave");

  function open() {
    if (form) {
      form.reset();
      errorEl.style.display = "none";
      successEl.style.display = "none";
    }
    overlay.classList.add("open");
    const first = overlay.querySelector("input") || overlay.querySelector(".modal-footer button");
    if (first) first.focus();
  }

  function close() {
    overlay.classList.remove("open");
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = "block";
    successEl.style.display = "none";
  }

  chip.addEventListener("click", open);
  overlay.querySelectorAll("[data-account-close]").forEach((el) => el.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) close();
  });

  if (!form) return; // acesso de emergência: só a explicação

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("accountCurrent").value;
    const newPassword = document.getElementById("accountNew").value;
    const confirmPassword = document.getElementById("accountConfirm").value;

    if (newPassword.length < 8) return showError("A nova senha precisa ter pelo menos 8 caracteres.");
    if (newPassword !== confirmPassword) return showError("A confirmação não confere com a nova senha.");

    saveBtn.disabled = true;
    try {
      await window.Dash.api("/api/me/password", { method: "PUT", body: { currentPassword, newPassword } });
      form.reset();
      errorEl.style.display = "none";
      successEl.style.display = "block";
    } catch (err) {
      showError(err.message || "Não foi possível trocar a senha.");
    } finally {
      saveBtn.disabled = false;
    }
  });
})();
