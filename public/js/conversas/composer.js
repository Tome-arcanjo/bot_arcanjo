/**
 * Caixa de resposta: texto, resposta citando uma mensagem, anexos (botão,
 * arrastar e soltar, colar), emojis, figurinhas e áudio gravado no navegador.
 * Enviar assume a conversa (a IA para) — regra do servidor (handoverService).
 */
import { state, emit, on, api, escapeHtml, icon, summaryHtml, quoteAuthor, withTakeover, fmtSize } from "./store.js";
import { appendMessage, renderWindow } from "./thread.js";
import { EMOJI_GROUPS, splitEmojis } from "./emoji.js";

const el = (id) => document.getElementById(id);
const composer = el("threadComposer");
const input = el("composerInput");
const sendBtn = el("composerSend");
const replyBar = el("composerReply");
const filesBar = el("composerFiles");
const fileInput = el("fileInput");
const emojiPanel = el("emojiPanel");
const emojiGrid = el("emojiGrid");
const stickerGrid = el("stickerGrid");
const recordingBar = el("composerRecording");
const composerRow = el("composerRow");
const threadEl = el("conversasThread");

let files = []; // [{ file, url }] anexos esperando o envio
let busy = false;

// ── Resposta citada ──────────────────────────────────────────────────────
function renderReply() {
  const m = state.replyTo;
  replyBar.hidden = !m;
  if (!m) return;
  replyBar.innerHTML = `
    <div class="composer-reply-quote"><strong>${escapeHtml(quoteAuthor(m))}</strong><span>${summaryHtml(m)}</span></div>
    <button type="button" class="composer-x" data-clear-reply aria-label="Cancelar resposta">${icon("x")}</button>`;
}
export function setReply(m) {
  state.replyTo = m;
  renderReply();
  input.focus();
}
replyBar.addEventListener("click", (e) => e.target.closest("[data-clear-reply]") && setReply(null));

// ── Anexos ───────────────────────────────────────────────────────────────
function renderFiles() {
  filesBar.hidden = files.length === 0;
  filesBar.innerHTML = files
    .map(({ file, url }, i) => `
      <div class="composer-file">
        ${url ? `<img src="${url}" alt="" />` : `<span class="composer-file-icon">${icon(file.type.startsWith("audio/") ? "mic" : file.type.startsWith("video/") ? "video" : "file")}</span>`}
        <span class="composer-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}<small>${escapeHtml(fmtSize(file.size))}</small></span>
        <button type="button" class="composer-x" data-remove-file="${i}" aria-label="Remover anexo">${icon("x")}</button>
      </div>`)
    .join("") + (files.length ? `<span class="composer-files-hint">O texto digitado vai como legenda do primeiro anexo.</span>` : "");
  syncActions();
}
const MAX_FILE_BYTES = 25 * 1024 * 1024; // mesmo limite do servidor (mediaService)

export function addFiles(list) {
  const tooBig = [...list].filter((f) => f.size > MAX_FILE_BYTES);
  if (tooBig.length) alert(`Arquivo grande demais (máximo de 25 MB): ${tooBig.map((f) => f.name).join(", ")}`);
  for (const file of list) {
    if (file.size <= MAX_FILE_BYTES) files.push({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  }
  renderFiles();
  input.focus();
}
function clearFiles() {
  files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
  files = [];
  renderFiles();
}
filesBar.addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove-file]");
  if (!rm) return;
  const [removed] = files.splice(Number(rm.dataset.removeFile), 1);
  if (removed?.url) URL.revokeObjectURL(removed.url);
  renderFiles();
});
el("btnAttach").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

// Arrastar arquivos para a conversa e colar imagens (Ctrl+V).
const canWrite = () => !composer.hidden && !input.disabled;
threadEl.addEventListener("dragover", (e) => {
  if (!canWrite() || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
  e.preventDefault();
  threadEl.classList.add("is-drop");
});
threadEl.addEventListener("dragleave", () => threadEl.classList.remove("is-drop"));
threadEl.addEventListener("drop", (e) => {
  threadEl.classList.remove("is-drop");
  if (!canWrite() || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});
input.addEventListener("paste", (e) => {
  const pasted = [...(e.clipboardData?.files || [])];
  if (pasted.length) {
    e.preventDefault();
    addFiles(pasted);
  }
});

// ── Envio ────────────────────────────────────────────────────────────────
function upload(sessionId, blob, { name, mime, kind, caption, replyTo }, force) {
  const qs = new URLSearchParams({ mime: mime || blob.type || "application/octet-stream", name: name || "arquivo" });
  if (kind) qs.set("kind", kind);
  if (caption) qs.set("caption", caption);
  if (replyTo) qs.set("replyTo", replyTo);
  if (force) qs.set("force", "true");
  return api(`/api/conversas/${sessionId}/media?${qs}`, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

/**
 * Envia algo da conversa aberta, tratando quem já atende (confirmação) e a
 * janela de 24 h. `request(force)` faz a chamada; devolve true se enviou.
 */
async function send(request, what) {
  const sessionId = state.activeId;
  try {
    const json = await withTakeover(request, what);
    if (!json) return false;
    if (json.data && state.activeId === sessionId) appendMessage(json.data);
    emit("handled");
    return true;
  } catch (err) {
    if (err.code === "WINDOW_CLOSED") {
      state.active.window = err.body.window || { ...state.active.window, open: false };
      renderWindow();
    } else {
      alert(err.message || "Não foi possível enviar.");
    }
    return false;
  }
}

async function submit(e) {
  e?.preventDefault();
  if (busy || !state.activeId) return;
  const content = input.value.trim();
  if (!content && files.length === 0) return;
  const sessionId = state.activeId;
  const replyTo = state.replyTo?.id || null;
  busy = true;
  sendBtn.disabled = true;
  try {
    if (files.length) {
      const queue = [...files];
      for (const [i, { file }] of queue.entries()) {
        const first = i === 0;
        const ok = await send(
          (force) => upload(sessionId, file, { name: file.name, mime: file.type, caption: first ? content : "", replyTo: first ? replyTo : null }, force),
          "Enviar o anexo"
        );
        if (!ok) return;
      }
      clearFiles();
    } else {
      const ok = await send(
        (force) => api(`/api/conversas/${sessionId}/messages`, { method: "POST", body: { content, replyTo, force } }),
        "Responder"
      );
      if (!ok) return;
    }
    input.value = "";
    autoGrow();
    setReply(null);
  } finally {
    busy = false;
    sendBtn.disabled = Boolean(state.active && !state.active.window.open);
    input.focus();
  }
}
composer.addEventListener("submit", submit);

// Enter envia; Shift+Enter quebra a linha. A caixa cresce até ~6 linhas.
function autoGrow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
  syncActions();
}

// Como no WhatsApp: sem texto nem anexo o botão é o microfone; com algo para enviar, vira "enviar".
function syncActions() {
  const hasContent = input.value.trim() !== "" || files.length > 0;
  sendBtn.hidden = !hasContent;
  el("btnMic").hidden = hasContent;
}
input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === "Escape" && state.replyTo) {
    setReply(null);
  }
});

// ── Emojis e figurinhas ──────────────────────────────────────────────────
emojiGrid.innerHTML = EMOJI_GROUPS.map(
  ([title, list]) => `<div class="emoji-group-title">${escapeHtml(title)}</div>${splitEmojis(list).map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}`
).join("");

function insertAtCursor(text) {
  const { selectionStart: start, selectionEnd: end, value } = input;
  input.value = value.slice(0, start) + text + value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
  autoGrow();
}

el("btnEmoji").addEventListener("click", () => {
  emojiPanel.hidden = !emojiPanel.hidden;
});
document.addEventListener("click", (e) => {
  if (!emojiPanel.hidden && !emojiPanel.contains(e.target) && e.target.id !== "btnEmoji") emojiPanel.hidden = true;
});
emojiGrid.addEventListener("click", (e) => {
  const b = e.target.closest("[data-emoji]");
  if (b) insertAtCursor(b.dataset.emoji);
});

emojiPanel.querySelectorAll("[data-panel]").forEach((tab) =>
  tab.addEventListener("click", () => {
    emojiPanel.querySelectorAll("[data-panel]").forEach((t) => t.classList.toggle("active", t === tab));
    emojiGrid.hidden = tab.dataset.panel !== "emojis";
    stickerGrid.hidden = tab.dataset.panel !== "stickers";
    if (!stickerGrid.hidden) loadStickers();
  })
);

async function loadStickers() {
  stickerGrid.innerHTML = `<p class="dash-empty">Carregando…</p>`;
  try {
    const { data } = await api("/api/conversas/stickers");
    stickerGrid.innerHTML =
      `<button type="button" class="sticker-new" data-new-sticker title="Transforma uma imagem em figurinha (512×512, WebP)">${icon("plus")}<span>Criar de uma imagem</span></button>` +
      data.map((s) => `<button type="button" class="sticker-item" data-sticker="${escapeHtml(s.messageId)}"><img src="/api/conversas/media/${encodeURIComponent(s.messageId)}" alt="Figurinha" loading="lazy" /></button>`).join("");
  } catch (err) {
    stickerGrid.innerHTML = `<p class="dash-empty">${escapeHtml(err.message)}</p>`;
  }
}

stickerGrid.addEventListener("click", async (e) => {
  if (e.target.closest("[data-new-sticker]")) return stickerInput.click();
  const item = e.target.closest("[data-sticker]");
  if (!item || !state.activeId) return;
  emojiPanel.hidden = true;
  const sessionId = state.activeId;
  const replyTo = state.replyTo?.id || null;
  if (await send((force) => api(`/api/conversas/${sessionId}/sticker`, { method: "POST", body: { messageId: item.dataset.sticker, replyTo, force } }), "Enviar a figurinha")) {
    setReply(null);
  }
});

// Figurinha nova: qualquer imagem vira WebP 512×512 (exigência do WhatsApp).
const stickerInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
document.body.appendChild(stickerInput);

async function toSticker(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = Object.assign(document.createElement("canvas"), { width: 512, height: 512 });
  const scale = Math.min(512 / bitmap.width, 512 / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  canvas.getContext("2d").drawImage(bitmap, (512 - w) / 2, (512 - h) / 2, w, h);
  for (const quality of [0.9, 0.75, 0.6, 0.45]) {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", quality));
    if (!blob || blob.type !== "image/webp") throw new Error("Este navegador não gera imagens WebP. Use o Chrome ou o Edge.");
    if (blob.size <= 100 * 1024) return blob; // figurinha estática: até 100 KB
  }
  throw new Error("Não foi possível deixar a figurinha com menos de 100 KB. Tente uma imagem mais simples.");
}

stickerInput.addEventListener("change", async () => {
  const file = stickerInput.files[0];
  stickerInput.value = "";
  if (!file || !state.activeId) return;
  emojiPanel.hidden = true;
  try {
    const blob = await toSticker(file);
    const sessionId = state.activeId;
    await send((force) => upload(sessionId, blob, { name: "figurinha.webp", mime: "image/webp", kind: "sticker", replyTo: state.replyTo?.id }, force), "Enviar a figurinha");
    setReply(null);
  } catch (err) {
    alert(err.message);
  }
});

// ── Áudio gravado no navegador ───────────────────────────────────────────
// OGG/Opus é o "áudio de voz" do WhatsApp. O Chrome só grava WebM: o
// servidor converte (precisa do ffmpeg na VPS).
const AUDIO_TYPES = ["audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
let recorder = null;
let chunks = [];
let recStart = 0;
let recTimer = null;

function setRecording(on) {
  recordingBar.hidden = !on;
  composerRow.hidden = on;
  clearInterval(recTimer);
  if (on) {
    recStart = Date.now();
    el("recTime").textContent = "0:00";
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      el("recTime").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 500);
  }
}

el("btnMic").addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return alert("Este navegador não grava áudio.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || "";
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start();
    setRecording(true);
  } catch (err) {
    alert(err.name === "NotAllowedError" ? "Permita o uso do microfone para gravar áudio." : `Não foi possível gravar: ${err.message}`);
  }
});

function stopRecording() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === "inactive") return resolve(null);
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorder.stop();
  });
}

el("recCancel").addEventListener("click", async () => {
  await stopRecording();
  setRecording(false);
});
el("recSend").addEventListener("click", async () => {
  const blob = await stopRecording();
  setRecording(false);
  if (!blob?.size || !state.activeId) return;
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
  const sessionId = state.activeId;
  await send((force) => upload(sessionId, blob, { name: `audio-${Date.now()}.${ext}`, mime: blob.type, kind: "voice", replyTo: state.replyTo?.id }, force), "Enviar o áudio");
  setReply(null);
});

// ── Troca de conversa: limpa rascunho de anexos/resposta ──────────────────
on("opened", () => {
  clearFiles();
  setReply(null);
  emojiPanel.hidden = true;
});
on("reply", (m) => setReply(m));
syncActions();
