// ========== Estado da aplicação ==========
let currentSessionId = null;
let isLoading = false;
let globalPersonality = "";

// ========== Elementos do DOM ==========
const btnNewChat      = document.getElementById("btnNewChat");
const btnStartChat    = document.getElementById("btnStartChat");
const btnSend         = document.getElementById("btnSend");
const sessionsList    = document.getElementById("sessionsList");
const messages        = document.getElementById("messages");
const chatEmpty       = document.getElementById("chatEmpty");
const chatInputArea   = document.getElementById("chatInputArea");
const messageInput    = document.getElementById("messageInput");
const btnPersonality  = document.getElementById("btnPersonality");
const modalOverlay    = document.getElementById("modalOverlay");
const modalClose      = document.getElementById("modalClose");
const btnModalCancel  = document.getElementById("btnModalCancel");
const btnModalSave    = document.getElementById("btnModalSave");
const personalityInput = document.getElementById("personalityInput");

// ========== Personalidade ==========
async function loadPersonalityFromServer() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    globalPersonality = data.systemPrompt || "";
    updatePersonalityBadge();
  } catch (e) {
    console.error("Erro ao carregar personalidade:", e);
  }
}

async function savePersonality(text) {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemPrompt: text })
    });
    const data = await res.json();
    if (data.success) {
      globalPersonality = text;
      updatePersonalityBadge();
    }
  } catch (e) {
    console.error("Erro ao salvar personalidade:", e);
    showToast("Erro ao salvar personalidade");
  }
}

function updatePersonalityBadge() {
  btnPersonality.classList.toggle("active", !!globalPersonality);
}

// ========== Modal ==========
function openModal() {
  personalityInput.value = globalPersonality;
  modalOverlay.classList.add("open");
  personalityInput.focus();
}

function closeModal() {
  modalOverlay.classList.remove("open");
}

btnPersonality.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
btnModalCancel.addEventListener("click", closeModal);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

btnModalSave.addEventListener("click", () => {
  savePersonality(personalityInput.value);
  closeModal();
  showToast("Personalidade salva!");
});

// Presets
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    personalityInput.value = btn.dataset.preset;
  });
});

// ========== Toast ==========
function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ========== API helpers ==========
async function api(method, path, body) {
  const res = await fetch(`/api/chat${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Erro desconhecido");
  return data;
}

// ========== Sessões ==========
async function loadSessions() {
  try {
    const { sessions } = await api("GET", "/sessions");
    renderSessions(sessions);
  } catch (e) {
    console.error("Erro ao carregar sessões:", e);
  }
}

function renderSessions(sessions) {
  if (!sessions || sessions.length === 0) {
    sessionsList.innerHTML = `<p class="sessions-empty">Nenhuma conversa ainda.<br/>Clique em + para começar.</p>`;
    return;
  }

  sessionsList.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === currentSessionId ? "active" : ""}" data-id="${s.id}">
      <span class="session-title">${escapeHtml(s.title)}</span>
      <button class="session-delete" data-id="${s.id}" title="Deletar">✕</button>
    </div>
  `).join("");

  sessionsList.querySelectorAll(".session-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("session-delete")) return;
      openSession(el.dataset.id);
    });
  });

  sessionsList.querySelectorAll(".session-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDeleteSession(btn.dataset.id);
    });
  });
}

async function createNewSession() {
  if (isLoading) return;
  try {
    const { session } = await api("POST", "/sessions", { provider: "openai" });
    currentSessionId = session.id;
    await loadSessions();
    showChat();
    messages.innerHTML = "";
  } catch (e) {
    showToast("Erro: " + e.message);
  }
}

async function openSession(id) {
  currentSessionId = id;
  await loadSessions();
  showChat();
  await loadMessages(id);
}

async function loadMessages(sessionId) {
  try {
    const { messages: msgs } = await api("GET", `/sessions/${sessionId}/messages`);
    messages.innerHTML = "";
    msgs.forEach(m => appendMessage(m.role, m.content));
    scrollToBottom();
  } catch (e) {
    console.error("Erro ao carregar mensagens:", e);
  }
}

async function confirmDeleteSession(id) {
  if (!confirm("Deletar esta conversa?")) return;
  try {
    await api("DELETE", `/sessions/${id}`);
    if (currentSessionId === id) {
      currentSessionId = null;
      showEmpty();
    }
    await loadSessions();
  } catch (e) {
    showToast("Erro ao deletar: " + e.message);
  }
}

// ========== Mensagens ==========
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || !currentSessionId || isLoading) return;

  isLoading = true;
  messageInput.value = "";
  messageInput.style.height = "auto";
  btnSend.disabled = true;

  appendMessage("user", content);
  const typingEl = appendTyping();
  scrollToBottom();

  try {
    const { message } = await api("POST", `/sessions/${currentSessionId}/message`, {
      content,
      provider: "openai"
    });
    typingEl.remove();
    appendMessage("assistant", message.content);
    scrollToBottom();
    await loadSessions();
  } catch (e) {
    typingEl.remove();
    appendMessage("assistant", `⚠️ Erro: ${e.message}`);
  } finally {
    isLoading = false;
    btnSend.disabled = false;
    messageInput.focus();
  }
}

function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.innerHTML = `<div class="message-bubble">${formatContent(content)}</div>`;
  messages.appendChild(div);
  return div;
}

function appendTyping() {
  const div = document.createElement("div");
  div.className = "message assistant";
  div.innerHTML = `
    <div class="message-bubble typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  messages.appendChild(div);
  return div;
}

// ========== UI helpers ==========
function showChat() {
  chatEmpty.style.display = "none";
  messages.style.display = "flex";
  chatInputArea.style.display = "flex";
  messageInput.focus();
}

function showEmpty() {
  chatEmpty.style.display = "flex";
  messages.style.display = "none";
  chatInputArea.style.display = "none";
  messages.innerHTML = "";
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatContent(text) {
  return escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

// ========== Auto-resize textarea ==========
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ========== Eventos ==========
btnNewChat.addEventListener("click", createNewSession);
btnStartChat.addEventListener("click", createNewSession);
btnSend.addEventListener("click", sendMessage);

// ========== Init ==========
loadPersonalityFromServer();
loadSessions();
