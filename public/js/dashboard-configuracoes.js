(function () {
  const textarea = document.getElementById("systemPromptInput");
  const btnSave = document.getElementById("btnSavePrompt");
  const saveStatus = document.getElementById("saveStatus");

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      textarea.value = data.systemPrompt || "";
    } catch (e) {
      console.error("Erro ao carregar configurações:", e);
    }
  }

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      textarea.value = btn.dataset.preset;
    });
  });

  btnSave.addEventListener("click", async () => {
    const systemPrompt = textarea.value.trim();
    if (!systemPrompt) return;

    btnSave.disabled = true;
    btnSave.textContent = "Salvando...";
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");

      saveStatus.style.display = "inline";
      setTimeout(() => { saveStatus.style.display = "none"; }, 2500);
    } catch (e) {
      alert("Não foi possível salvar a personalidade. Tente novamente.");
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "Salvar";
    }
  });

  loadSettings();
})();
