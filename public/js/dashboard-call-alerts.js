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
  const LAST_NOTIFIED_KEY = "callAlertLastNotifiedAt";
  // Espaço mínimo entre duas notificações do sistema (mesmo entre abas). Os avisos
  // legítimos já saem a cada 30 min; isto só segura rajadas.
  const MIN_GAP_MS = 60 * 1000;
  const MAX_TOASTS = 3; // faixas visíveis ao mesmo tempo; o resto vira "e mais N"

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
  // Sempre UMA notificação por vez, mesmo com várias ligações atrasadas (vira um
  // resumo), com a mesma "tag" (a nova SUBSTITUI a anterior em vez de empilhar) e
  // sem requireInteraction (não fica fixa na tela). Rajadas de notificações
  // incomodam e são o que extensões como o Malwarebytes Browser Guard bloqueiam
  // como "excesso de notificações".
  function systemNotify(calls) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const single = calls.length === 1;
    const title = single ? "⏰ Ligação atrasada" : "⏰ " + calls.length + " ligações atrasadas";
    const body = single
      ? describe(calls[0]) + "\nAviso " + (calls[0].slot + 1) + " de " + calls[0].total
      : calls.slice(0, 3).map((c) => c.client_name || c.phone).join(", ") +
        (calls.length > 3 ? " e mais " + (calls.length - 3) : "");

    try {
      const n = new Notification(title, { body: body, tag: "call-overdue" });
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

    const visible = calls.filter((call) => {
      const key = keyOf(call);
      return !(dismissed[key] !== undefined && dismissed[key] >= call.slot);
    });

    visible.slice(0, MAX_TOASTS).forEach((call) => {
      const key = keyOf(call);
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

    if (visible.length > MAX_TOASTS) {
      const more = document.createElement("div");
      more.className = "call-toast call-toast-more";
      more.innerHTML = `<div class="call-toast-body">e mais ${visible.length - MAX_TOASTS} ligação(ões) atrasada(s)</div>
        <a class="call-toast-link" href="/dashboard/crm">Abrir CRM</a>`;
      container.appendChild(more);
    }
  }

  function updateTitle(count) {
    document.title = count > 0 ? "⚠ (" + count + ") " + baseTitle : baseTitle;
  }

  // ── consulta ao servidor ──
  function readLastNotifiedAt() {
    try {
      return Number(localStorage.getItem(LAST_NOTIFIED_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeLastNotifiedAt(ms) {
    try {
      localStorage.setItem(LAST_NOTIFIED_KEY, String(ms));
    } catch (e) { /* sem storage */ }
  }

  let polling = false;
  let pollAgain = false;

  // Nunca duas consultas ao mesmo tempo (ex.: a de 30 s + o "refresh" do CRM):
  // duas rodando juntas leriam o mesmo "ainda não avisei" e avisariam em dobro.
  async function poll() {
    if (polling) {
      pollAgain = true;
      return;
    }
    polling = true;
    try {
      await checkOverdueCalls();
    } finally {
      polling = false;
    }
    if (pollAgain) {
      pollAgain = false;
      poll();
    }
  }

  async function checkOverdueCalls() {
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

    const seen = readJson(localStorage, SEEN_KEY);
    const fresh = calls.filter((call) => {
      const last = seen[keyOf(call)];
      return last === undefined || call.slot > last;
    });

    // Todas as ligações "novas" saem juntas, em UMA notificação — e só se já
    // passou o espaçamento mínimo desde a última. Se ainda não passou, elas
    // continuam "novas" e entram no próximo ciclo (a faixa na tela aparece já).
    const now = Date.now();
    const notifyNow = fresh.length > 0 && now - readLastNotifiedAt() >= MIN_GAP_MS;

    // Reescrever só com as ligações ainda atrasadas também limpa as antigas.
    const next = {};
    calls.forEach((call) => {
      const key = keyOf(call);
      const isNotified = notifyNow && fresh.indexOf(call) !== -1;
      const value = isNotified ? call.slot : seen[key];
      if (value !== undefined) next[key] = value;
    });
    writeJson(localStorage, SEEN_KEY, next);
    if (notifyNow) writeLastNotifiedAt(now);

    renderToasts(calls);
    updateTitle(calls.length);

    if (notifyNow) {
      beep();
      systemNotify(fresh);
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
