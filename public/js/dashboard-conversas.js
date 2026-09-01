(function () {
  const listEl = document.getElementById("conversasList");
  const threadEl = document.getElementById("conversasThread");
  let activeSessionId = null;
  let cachedSessions = [];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sessionLabel(s) {
    return s.phone ? `📱 ${s.phone}` : `💻 ${s.title || "Conversa web"}`;
  }

  async function loadConversas() {
    try {
      const res = await fetch("/api/conversas");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      cachedSessions = json.data || [];
      renderList(cachedSessions);
      openFromDeepLinkIfNeeded();
    } catch (e) {
      listEl.innerHTML = `<p class="dash-empty">Erro ao carregar conversas.</p>`;
    }
  }

  // Compara só os dígitos: o WhatsApp grava o telefone da sessão sem
  // formatação (ex: "5511999999999"), mas um caso criado manualmente no
  // CRM pode ter sido digitado como "+55 11 99999-9999" — sem isso, o link
  // não encontraria a conversa correspondente.
  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
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
      const preview = s.lastMessage ? s.lastMessage.content : "Sem mensagens";
      btn.innerHTML = `
        <div class="conversa-item-title">${escapeHtml(sessionLabel(s))}</div>
        <div class="conversa-item-preview">${escapeHtml(preview)}</div>
      `;
      btn.addEventListener("click", () => selectSession(s));
      listEl.appendChild(btn);
    });
  }

  async function selectSession(session) {
    activeSessionId = session.id;
    renderList(cachedSessions);

    threadEl.innerHTML = `<p class="dash-empty">Carregando mensagens...</p>`;
    try {
      const res = await fetch(`/api/conversas/${session.id}/messages`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      renderThread(json.data || [], session);
    } catch (e) {
      threadEl.innerHTML = `<p class="dash-empty">Erro ao carregar a conversa.</p>`;
    }
  }

  function renderThread(messages, session) {
    if (messages.length === 0) {
      threadEl.innerHTML = `<p class="dash-empty">Essa conversa ainda não tem mensagens.</p>`;
      return;
    }

    threadEl.innerHTML = messages.map((m) => {
      const time = new Date(m.created_at).toLocaleString("pt-BR");
      const cls = m.role === "user" ? "user" : "assistant";
      return `<div class="thread-msg ${cls}">${escapeHtml(m.content)}<div class="thread-msg-time">${time}</div></div>`;
    }).join("");

    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function appendMessageToThread(m) {
    if (threadEl.querySelector('.dash-empty')) {
      threadEl.innerHTML = "";
    }
    const time = new Date(m.created_at).toLocaleString("pt-BR");
    const cls = m.role === "user" ? "user" : "assistant";
    const msgHtml = `<div class="thread-msg ${cls}">${escapeHtml(m.content)}<div class="thread-msg-time">${time}</div></div>`;
    threadEl.insertAdjacentHTML("beforeend", msgHtml);
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  // Configuração do SSE para atualizações em tempo real
  const evtSource = new EventSource("/api/conversas/stream");
  evtSource.onmessage = function (event) {
    const data = JSON.parse(event.data);
    const { message, session } = data;

    // Atualiza a lista de conversas
    let sessionIndex = cachedSessions.findIndex((s) => s.id === session.id);
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
    }
  };

  loadConversas();
})();
