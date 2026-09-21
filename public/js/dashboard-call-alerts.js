// Avisos de "ligação atrasada" no navegador. Carregado por TODAS as telas do
// painel (ver views/dashboardLayout.js), então o admin é avisado esteja em
// Conversas, CRM ou Contatos — desde que alguma aba do painel esteja aberta.
//
// O servidor devolve as ligações pendentes já atrasadas (janela de 3h) com o
// "intervalo de aviso" atual de cada uma: 0 ao passar do horário, 1 aos +30 min,
// ... até 6 aos +180 min. Sempre que o intervalo de uma ligação aumenta, este
// script dispara o aviso (notificação do sistema + som). O último intervalo já
// avisado fica no localStorage, para não repetir o aviso a cada recarga da página.
(function () {
  const POLL_MS = 30 * 1000;
  const SEEN_KEY = "callAlertSeenSlots";
  const DISMISSED_KEY = "callAlertDismissedSlots";

  const baseTitle = document.title;
  let audioCtx = null;
  let lastCalls = [];

  const container = document.createElement("div");
  container.className = "call-toasts";
  container.setAttribute("aria-live", "assertive");
  document.body.appendChild(container);

  // ── storage (pode falhar em navegação privada etc.; nunca deve quebrar a tela) ──
  function readJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key)) || {};
    } catch (e) {
      return {};
    }
  }
  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* sem storage: só perde a memória de "já avisei" */
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function keyOf(call) {
    return call.id + "|" + call.call_scheduled_at;
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function fmtDuration(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return m + " min";
    return m === 0 ? h + "h" : h + "h " + m + "min";
  }

  function describe(call) {
    const who = call.client_name ? call.client_name + " (" + call.phone + ")" : call.phone;
    return (
      who + " · marcada para " + fmtTime(call.call_scheduled_at) +
      " · atraso de " + fmtDuration(call.overdue_minutes)
    );
  }

  // ── som ──
  // Navegadores só liberam áudio depois de um gesto do usuário; o primeiro
  // clique em qualquer lugar do painel já destrava o som dos próximos avisos.
  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* sem áudio */ }
  }
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  function beep() {
    try {
      if (!audioCtx || audioCtx.state !== "running") return;
      [0, 0.28, 0.56].forEach((offset) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + offset + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.22);
      });
    } catch (e) { /* sem áudio */ }
  }

  // ── notificação do sistema ──
  function systemNotify(call) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const n = new Notification("⏰ Ligação atrasada", {
        body: describe(call) + "\nAviso " + (call.slot + 1) + " de " + call.total,
        tag: keyOf(call), // o mesmo caso substitui o aviso anterior em vez de empilhar
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        window.location.href = "/dashboard/crm";
        n.close();
      };
    } catch (e) { /* alguns navegadores móveis exigem service worker */ }
  }

  // ── faixas (toasts) dentro da página ──
  function renderToasts(calls) {
    const dismissed = readJson(sessionStorage, DISMISSED_KEY);
    container.innerHTML = "";

    calls.forEach((call) => {
      const key = keyOf(call);
      if (dismissed[key] !== undefined && dismissed[key] >= call.slot) return;

      const toast = document.createElement("div");
      toast.className = "call-toast";
      toast.innerHTML = `
        <button type="button" class="call-toast-close" title="Dispensar" aria-label="Dispensar">✕</button>
        <div class="call-toast-title">⏰ Ligação atrasada</div>
        <div class="call-toast-body">${escapeHtml(describe(call))}</div>
        <div class="call-toast-meta">Aviso ${call.slot + 1} de ${call.total} · repete a cada 30 min</div>
        <a class="call-toast-link" href="/dashboard/crm">Abrir CRM</a>
      `;
      toast.querySelector(".call-toast-close").addEventListener("click", () => {
        const d = readJson(sessionStorage, DISMISSED_KEY);
        d[key] = call.slot;
        writeJson(sessionStorage, DISMISSED_KEY, d);
        toast.remove();
      });
      container.appendChild(toast);
    });
  }

  function updateTitle(count) {
    document.title = count > 0 ? "⚠ (" + count + ") " + baseTitle : baseTitle;
  }

  // ── consulta ao servidor ──
  async function poll() {
    let calls;
    try {
      const res = await fetch("/api/crm/calls/overdue", { cache: "no-store" });
      if (!res.ok) return; // 401 (sessão expirada) ou erro: tenta de novo no próximo ciclo
      const json = await res.json();
      if (!json.success) return;
      calls = json.data || [];
    } catch (e) {
      return;
    }
    lastCalls = calls;

    const seen = readJson(localStorage, SEEN_KEY);
    const next = {}; // reescrever só com as ligações ainda atrasadas limpa as antigas
    const fresh = [];
    calls.forEach((call) => {
      const key = keyOf(call);
      const last = seen[key];
      next[key] = last === undefined ? call.slot : Math.max(last, call.slot);
      if (last === undefined || call.slot > last) fresh.push(call);
    });
    writeJson(localStorage, SEEN_KEY, next);

    renderToasts(calls);
    updateTitle(calls.length);

    if (fresh.length > 0) {
      beep();
      fresh.forEach(systemNotify);
    }
  }

  // ── botão "Ativar alertas" (permissão de notificação exige um clique) ──
  function setupPermissionButton() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    const actions = document.querySelector(".dash-topbar-actions");
    if (!actions) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = "🔔 Ativar alertas";
    btn.title = "Permitir notificações do navegador para ligações atrasadas";
    btn.addEventListener("click", async () => {
      unlockAudio();
      try {
        await Notification.requestPermission();
      } catch (e) { /* ignorado */ }
      btn.remove();
    });
    actions.prepend(btn);
  }

  // O CRM avisa quando o admin conclui/cancela/remarca, para o alerta sumir na hora.
  window.addEventListener("call-alerts:refresh", poll);

  setupPermissionButton();
  poll();
  setInterval(poll, POLL_MS);
})();
