(function () {
  const { escapeHtml, avatarHtml, api, me } = window.Dash;

  const listEl = document.getElementById("conversasList");
  const threadEl = document.getElementById("conversasThread");
  const headerEl = document.getElementById("threadHeader");
  const titleEl = document.getElementById("threadTitle");
  const subEl = document.getElementById("threadSub");
  const statusEl = document.getElementById("threadStatus");
  const btnAssumir = document.getElementById("btnAssumir");
  const btnDevolver = document.getElementById("btnDevolver");
  const presenceEl = document.getElementById("threadPresence");
  const windowEl = document.getElementById("threadWindow");
  const composer = document.getElementById("threadComposer");
  const composerInput = document.getElementById("composerInput");
  const composerSend = document.getElementById("composerSend");
  const composerHint = document.getElementById("composerHint");

  let activeSessionId = null;
  let cachedSessions = [];
  let team = []; // [{ id, name, role, active }] — nomes de quem respondeu/atende
  // Estado da conversa aberta: { session, window, viewers, sending }
  let active = null;
  let windowTimer = null;

  // ── Utilidades ─────────────────────────────────────────────────────────

  function userName(id) {
    const u = id ? team.find((x) => x.id === id) : null;
    return u ? u.name : null;
  }

  function firstName(name) {
    return String(name || "").trim().split(/\s+/)[0] || name;
  }

  function isMe(userId) {
    return Boolean(me) && (userId || null) === (me.id || null);
  }

  function sessionLabel(s) {
    return s.phone ? `📱 ${s.phone}` : `💻 ${s.title || "Conversa web"}`;
  }

  // Compara só os dígitos: o WhatsApp grava o telefone da sessão sem
  // formatação (ex: "5511999999999"), mas um caso criado manualmente no
  // CRM pode ter sido digitado como "+55 11 99999-9999" — sem isso, o link
  // não encontraria a conversa correspondente.
  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleString("pt-BR");
  }

  // ── Lista de conversas ─────────────────────────────────────────────────

  async function loadConversas() {
    try {
      const [convJson, teamJson] = await Promise.all([api("/api/conversas"), api("/api/crm/users")]);
      cachedSessions = convJson.data || [];
      team = teamJson.data || [];
      renderList(cachedSessions);
      openFromDeepLinkIfNeeded();
    } catch (e) {
      listEl.innerHTML = `<p class="dash-empty">Erro ao carregar conversas.</p>`;
    }
  }

  // Suporta chegar aqui vindo de outra tela (ex: clicando num caso no CRM)
  // via /dashboard/conversas?phone=5511999999999 — como um "router por id"
  // simples usando o telefone, que é a chave em comum entre as duas telas.
  function openFromDeepLinkIfNeeded() {
    const phone = new URLSearchParams(window.location.search).get("phone");
    if (!phone || activeSessionId) return; // sem link, ou já tem conversa aberta manualmente

    const targetDigits = onlyDigits(phone);
    const match = cachedSessions.find((s) => onlyDigits(s.phone) === targetDigits);
    if (match) {
      selectSession(match);
      // Limpa o parâmetro da URL pra um refresh depois não reabrir sempre
      // essa mesma conversa por engano.
      const url = new URL(window.location);
      url.searchParams.delete("phone");
      window.history.replaceState({}, "", url);
    } else {
      threadEl.innerHTML = `<p class="dash-empty">Esse caso ainda não tem nenhuma conversa registrada com o número ${escapeHtml(phone)}.</p>`;
    }
  }

  function previewText(m) {
    if (!m) return "Sem mensagens";
    if (m.role === "human") return `${isMe(m.sender_user_id) ? "Você" : firstName(userName(m.sender_user_id) || "Equipe")}: ${m.content}`;
    if (m.role === "assistant") return `IA: ${m.content}`;
    return m.content;
  }

  function handlerBadge(s) {
    if (!s.ai_paused) return `<span class="conversa-item-ia" title="A IA está respondendo">IA</span>`;
    const name = userName(s.handler_user_id);
    const user = s.handler_user_id ? { id: s.handler_user_id, name: name || "?" } : { id: null, name: "Equipe" };
    return `<span class="conversa-item-handler" title="Atendimento humano${name ? ": " + escapeHtml(name) : ""}">${avatarHtml(user, { small: true })}</span>`;
  }

  function renderList(sessions) {
    if (sessions.length === 0) {
      listEl.innerHTML = `<p class="dash-empty">Nenhuma conversa ainda.</p>`;
      return;
    }

    listEl.innerHTML = "";
    sessions.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "conversa-item" + (s.id === activeSessionId ? " active" : "");
      btn.dataset.id = s.id;
      btn.innerHTML = `
        <div class="conversa-item-top">
          <div class="conversa-item-title">${escapeHtml(sessionLabel(s))}</div>
          ${handlerBadge(s)}
        </div>
        <div class="conversa-item-preview">${escapeHtml(previewText(s.lastMessage))}</div>
      `;
      btn.addEventListener("click", () => selectSession(s));
      listEl.appendChild(btn);
    });
  }

  // ── Conversa aberta ────────────────────────────────────────────────────

  async function selectSession(session) {
    if (activeSessionId && activeSessionId !== session.id) leavePresence(activeSessionId);
    activeSessionId = session.id;
    active = null;
    renderList(cachedSessions);

    threadEl.innerHTML = `<p class="dash-empty">Carregando mensagens...</p>`;
    try {
      const [msgJson, stateJson] = await Promise.all([
        api(`/api/conversas/${session.id}/messages`),
        api(`/api/conversas/${session.id}/state`),
      ]);
      if (activeSessionId !== session.id) return; // trocou de conversa no meio
      active = stateJson.data;
      renderThread(msgJson.data || []);
      renderConversationChrome();
      sendPresence();
      if (!composerInput.disabled) composerInput.focus();
    } catch (e) {
      threadEl.innerHTML = `<p class="dash-empty">Erro ao carregar a conversa.</p>`;
    }
  }

  function renderConversationChrome() {
    renderHeader();
    renderPresence();
    renderWindow();
  }

  function renderHeader() {
    if (!active) return;
    const s = active.session;
    headerEl.hidden = false;
    titleEl.textContent = s.phone ? s.phone : s.title || "Conversa";
    subEl.innerHTML = s.phone
      ? `<a href="/dashboard/crm" class="thread-link">Ver no CRM</a>${s.title && !s.title.startsWith("WhatsApp:") ? ` · ${escapeHtml(s.title)}` : ""}`
      : "";

    const handler = userName(s.handler_user_id);
    if (s.ai_paused) {
      statusEl.className = "badge badge-green";
      statusEl.textContent = `Atendimento humano · ${isMe(s.handler_user_id) ? "você" : handler || "equipe"}`;
    } else {
      statusEl.className = "badge badge-gold";
      statusEl.textContent = "IA respondendo";
    }

    const mine = s.ai_paused && isMe(s.handler_user_id);
    btnAssumir.hidden = mine;
    btnAssumir.textContent = s.ai_paused ? "Assumir de " + firstName(handler || "outra pessoa") : "Assumir";
    btnDevolver.hidden = !s.ai_paused;
  }

  function renderPresence() {
    if (!active) return;
    const isSelf = (v) => Boolean(me) && (me.id ? v.id === me.id : !v.id && v.name === me.name);
    const others = (active.viewers || []).filter((v) => !isSelf(v));
    if (others.length === 0) {
      presenceEl.hidden = true;
      return;
    }
    const names = others.map((v) => v.name);
    const who = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " e " + names.at(-1);
    presenceEl.textContent = `👀 ${who} também ${names.length === 1 ? "está" : "estão"} com esta conversa aberta.`;
    presenceEl.hidden = false;
  }

  function renderWindow() {
    if (!active) return;
    clearTimeout(windowTimer);
    const w = active.window;
    composer.hidden = !active.session.phone;

    if (w.open) {
      windowEl.hidden = true;
      composerInput.disabled = false;
      composerSend.disabled = false;
      // Fecha sozinho quando passar das 24 h.
      const ms = Date.parse(w.closesAt) - Date.now();
      if (ms > 0 && ms < 2 ** 31) {
        windowTimer = setTimeout(() => {
          active.window.open = false;
          renderWindow();
        }, ms + 500);
      }
    } else {
      composerInput.disabled = true;
      composerSend.disabled = true;
      const since = w.lastClientMessageAt ? ` (última mensagem dele em ${fmtTime(w.lastClientMessageAt)})` : "";
      windowEl.innerHTML = `
        <div><strong>Fora da janela de 24 h.</strong> O cliente não fala com a gente há mais de 24 h${escapeHtml(since)},
        e o WhatsApp só permite retomar a conversa com um modelo de mensagem aprovado pela Meta.</div>
        ${w.templateConfigured
          ? `<button type="button" class="btn btn-secondary btn-sm" id="btnTemplate">Enviar modelo de retomada</button>`
          : `<div class="thread-window-note">Nenhum modelo configurado no servidor (WHATSAPP_TEMPLATE_REENGAGE).</div>`}
      `;
      windowEl.hidden = false;
      const btn = document.getElementById("btnTemplate");
      if (btn) btn.addEventListener("click", sendTemplate);
    }

    const sendingNote = active.sending === "off"
      ? "Envio pelo WhatsApp desligado no servidor: as mensagens ficam salvas como não enviadas."
      : active.sending === "simulated"
        ? "Modo simulado: nada é enviado de verdade pelo WhatsApp."
        : "";
    const windowNote = w.open && w.closesAt
      ? `Janela de 24 h aberta até ${new Date(w.closesAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`
      : "";
    composerHint.textContent = [windowNote, sendingNote].filter(Boolean).join(" ");
    composerHint.classList.toggle("is-warning", active.sending !== "on");
  }

  // ── Mensagens ──────────────────────────────────────────────────────────

  function statusHtml(m) {
    if (m.role === "user" || !m.delivery_status) return "";
    const simulated = m.wa_message_id && String(m.wa_message_id).startsWith("sim-") ? " (simulado)" : "";
    switch (m.delivery_status) {
      case "pending": return `<span class="msg-status is-pending">Enviando…</span>`;
      case "sent": return `<span class="msg-status">✓ Enviada${simulated}</span>`;
      case "delivered": return `<span class="msg-status">✓✓ Entregue</span>`;
      case "read": return `<span class="msg-status is-read">✓✓ Lida</span>`;
      case "failed":
        return `<span class="msg-status is-failed">Não enviada${m.delivery_error ? ": " + escapeHtml(m.delivery_error) : ""}</span>
          <button type="button" class="msg-retry" data-retry="${escapeHtml(m.id)}">Tentar de novo</button>`;
      default: return "";
    }
  }

  function authorHtml(m) {
    if (m.role === "human") {
      const name = isMe(m.sender_user_id) ? "Você" : userName(m.sender_user_id) || "Equipe";
      return `<div class="thread-msg-author">${escapeHtml(name)}</div>`;
    }
    if (m.role === "assistant") return `<div class="thread-msg-author">IA</div>`;
    return "";
  }

  function messageHtml(m) {
    const cls = m.role === "user" ? "user" : m.role === "human" ? "human" : "assistant";
    const failed = m.delivery_status === "failed" ? " is-failed" : "";
    const time = fmtTime(m.created_at);
    return `<div class="thread-msg ${cls}${failed}" data-id="${escapeHtml(m.id)}">${authorHtml(m)}${escapeHtml(m.content)}<div class="thread-msg-time" data-created="${escapeHtml(time)}">${escapeHtml(time)} ${statusHtml(m)}</div></div>`;
  }

  function renderThread(messages) {
    if (messages.length === 0) {
      threadEl.innerHTML = `<p class="dash-empty">Essa conversa ainda não tem mensagens.</p>`;
      return;
    }
    threadEl.innerHTML = messages.map(messageHtml).join("");
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function appendMessageToThread(m) {
    if (threadEl.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return; // já está na tela
    if (threadEl.querySelector(".dash-empty")) threadEl.innerHTML = "";
    const nearBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 120;
    threadEl.insertAdjacentHTML("beforeend", messageHtml(m));
    if (nearBottom || m.role !== "user") threadEl.scrollTop = threadEl.scrollHeight;
  }

  function updateMessageStatus({ messageId, status, error, waMessageId }) {
    const el = threadEl.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
    if (!el) return;
    const time = el.querySelector(".thread-msg-time");
    el.classList.toggle("is-failed", status === "failed");
    time.innerHTML = `${escapeHtml(time.dataset.created)} ${statusHtml({ id: messageId, role: "assistant", delivery_status: status, delivery_error: error, wa_message_id: waMessageId })}`;
  }

  // ── Ações ──────────────────────────────────────────────────────────────

  // Outra pessoa está atendendo: pergunta antes de passar por cima.
  function confirmTakeover(err, what) {
    const name = (err.body && err.body.handler && err.body.handler.name) || "Outra pessoa";
    return confirm(`${name} está atendendo esta conversa.\n${what} mesmo assim? A conversa passa para você.`);
  }

  async function withTakeover(request, what) {
    try {
      return await request(false);
    } catch (err) {
      if (err.code === "HANDLED_BY_OTHER" && confirmTakeover(err, what)) return request(true);
      throw err;
    }
  }

  async function sendMessage(e) {
    if (e) e.preventDefault();
    const content = composerInput.value.trim();
    if (!content || !activeSessionId) return;
    const sessionId = activeSessionId;
    composerSend.disabled = true;
    try {
      const json = await withTakeover(
        (force) => api(`/api/conversas/${sessionId}/messages`, { method: "POST", body: { content, force } }),
        "Responder"
      );
      composerInput.value = "";
      autoGrow();
      if (json && json.data && activeSessionId === sessionId) appendMessageToThread(json.data);
    } catch (err) {
      if (err.code === "WINDOW_CLOSED") {
        if (active) active.window = err.body.window || Object.assign({}, active.window, { open: false });
        renderWindow();
      } else {
        alert(err.message || "Não foi possível enviar a mensagem.");
      }
    } finally {
      composerSend.disabled = Boolean(active && !active.window.open);
      composerInput.focus();
    }
  }

  async function sendTemplate() {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;
    if (!confirm(`Enviar o modelo de retomada "${active.window.templateName}" para este cliente?`)) return;
    try {
      const json = await withTakeover(
        (force) => api(`/api/conversas/${sessionId}/template`, { method: "POST", body: { force } }),
        "Enviar o modelo"
      );
      if (json && json.data && activeSessionId === sessionId) appendMessageToThread(json.data);
    } catch (err) {
      alert(err.message || "Não foi possível enviar o modelo.");
    }
  }

  async function assume() {
    const sessionId = activeSessionId;
    try {
      const json = await withTakeover(
        (force) => api(`/api/conversas/${sessionId}/assume`, { method: "POST", body: { force } }),
        "Assumir"
      );
      if (json) applySessionUpdate(json.data);
    } catch (err) {
      alert(err.message || "Não foi possível assumir a conversa.");
    }
  }

  async function release() {
    if (!confirm("Devolver esta conversa à IA? Ela volta a responder o cliente automaticamente.")) return;
    try {
      const json = await api(`/api/conversas/${activeSessionId}/release`, { method: "POST" });
      applySessionUpdate(json.data);
    } catch (err) {
      alert(err.message || "Não foi possível devolver a conversa à IA.");
    }
  }

  async function retry(messageId) {
    try {
      await api(`/api/conversas/messages/${encodeURIComponent(messageId)}/retry`, { method: "POST" });
    } catch (err) {
      alert(err.message || "Não foi possível reenviar a mensagem.");
    }
  }

  btnAssumir.addEventListener("click", assume);
  btnDevolver.addEventListener("click", release);
  composer.addEventListener("submit", sendMessage);
  threadEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-retry]");
    if (btn) retry(btn.dataset.retry);
  });

  // Enter envia; Shift+Enter quebra a linha. A caixa cresce até ~6 linhas.
  function autoGrow() {
    composerInput.style.height = "auto";
    composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + "px";
  }
  composerInput.addEventListener("input", autoGrow);
  composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Presença ("estou com esta conversa aberta") ───────────────────────

  function sendPresence() {
    if (!activeSessionId || document.visibilityState !== "visible") return;
    api(`/api/conversas/${activeSessionId}/presence`, { method: "POST", body: {} })
      .then((json) => {
        if (active && json.data) {
          active.viewers = json.data;
          renderPresence();
        }
      })
      .catch(() => {});
  }

  function leavePresence(sessionId) {
    const body = new Blob([JSON.stringify({ leave: true })], { type: "application/json" });
    if (!navigator.sendBeacon || !navigator.sendBeacon(`/api/conversas/${sessionId}/presence`, body)) {
      api(`/api/conversas/${sessionId}/presence`, { method: "POST", body: { leave: true } }).catch(() => {});
    }
  }

  setInterval(sendPresence, 20000);
  document.addEventListener("visibilitychange", sendPresence);
  window.addEventListener("pagehide", () => {
    if (activeSessionId) leavePresence(activeSessionId);
  });

  // ── Tempo real (SSE) ───────────────────────────────────────────────────

  function applySessionUpdate(session) {
    const i = cachedSessions.findIndex((s) => s.id === session.id);
    if (i !== -1) cachedSessions[i] = Object.assign({}, cachedSessions[i], session);
    renderList(cachedSessions);
    if (active && active.session.id === session.id) {
      active.session = Object.assign({}, active.session, session);
      renderHeader();
    }
  }

  function onNewMessage(event) {
    const { message, session } = JSON.parse(event.data);

    // Atualiza a lista de conversas
    const sessionIndex = cachedSessions.findIndex((s) => s.id === session.id);
    if (sessionIndex !== -1) {
      cachedSessions[sessionIndex].lastMessage = message;
      // Move a sessão para o topo da lista
      const [updatedSession] = cachedSessions.splice(sessionIndex, 1);
      cachedSessions.unshift(updatedSession);
      renderList(cachedSessions);
    } else {
      // Sessão nova (não estava no cache), recarrega a lista toda
      loadConversas();
    }

    // Se for a sessão aberta no momento, adiciona a mensagem na tela
    if (activeSessionId === session.id) {
      appendMessageToThread(message);
      // Mensagem do cliente reabre a janela de 24 h.
      if (message.role === "user" && active) {
        active.window = Object.assign({}, active.window, {
          open: true,
          lastClientMessageAt: message.created_at,
          closesAt: new Date(Date.parse(message.created_at) + 24 * 60 * 60 * 1000).toISOString(),
        });
        renderWindow();
      }
    }
  }

  function connectStream() {
    const evtSource = new EventSource("/api/conversas/stream");
    let dropped = false;
    evtSource.onmessage = onNewMessage;
    evtSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.sessionId === activeSessionId) updateMessageStatus(data);
    });
    evtSource.addEventListener("session", (e) => applySessionUpdate(JSON.parse(e.data).session));
    evtSource.addEventListener("presence", (e) => {
      const { sessionId, viewers } = JSON.parse(e.data);
      if (active && sessionId === active.session.id) {
        active.viewers = viewers;
        renderPresence();
      }
    });
    evtSource.onopen = () => {
      // Voltou depois de cair: recarrega para não perder o que chegou no meio.
      if (dropped) {
        dropped = false;
        loadConversas();
        const current = cachedSessions.find((s) => s.id === activeSessionId);
        if (current) selectSession(current);
      }
    };
    evtSource.onerror = () => {
      dropped = true;
      // Fechado de vez (ex: sessão encerrada — 401): api() leva para o login.
      if (evtSource.readyState === EventSource.CLOSED) {
        api("/api/me").then(() => setTimeout(connectStream, 3000)).catch(() => {});
      }
    };
  }

  connectStream();
  loadConversas();
})();
