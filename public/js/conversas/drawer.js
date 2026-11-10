/**
 * Painel lateral do cliente (etiquetas jurídicas, atendimento, mídias) e os
 * modais de transferir, encerrar e encaminhar.
 */
import {
  state, on, api, escapeHtml, icon, isMe, isAdmin, userById, activeSession, stageOf, waitingSince, statusOf,
  patchSession, mediaUrl, summaryHtml, fmtWait, onlyDigits, modal,
} from "./store.js";
import { sessionAction, appendMessage } from "./thread.js";
import { visibleSessions } from "./list.js";

const { contactName, contactAvatarHtml, formatPhone, avatarHtml } = window.Dash;
const el = (id) => document.getElementById(id);
const drawer = el("contactDrawer");
const layout = el("conversasLayout");

// ── Painel do cliente ────────────────────────────────────────────────────
export function toggleDrawer(open = drawer.hidden) {
  drawer.hidden = !open;
  layout.classList.toggle("with-drawer", open);
  if (open) renderDrawer();
}

function mediaGallery() {
  const withFile = state.messages.filter((m) => m.media?.path && !m.deleted_at);
  const visual = withFile.filter((m) => m.message_type === "image" || m.message_type === "video" || m.message_type === "sticker").slice(-12).reverse();
  const docs = withFile.filter((m) => m.message_type === "document" || m.message_type === "audio").slice(-8).reverse();
  if (!visual.length && !docs.length) return `<p class="drawer-muted">Nenhum arquivo nesta conversa.</p>`;
  return `
    ${visual.length ? `<div class="drawer-media">${visual.map((m) => m.message_type === "video"
      ? `<a href="${mediaUrl(m)}" target="_blank" rel="noopener" class="drawer-media-video">${icon("video")}</a>`
      : `<a href="${mediaUrl(m)}" target="_blank" rel="noopener"><img src="${mediaUrl(m)}" alt="" loading="lazy" /></a>`).join("")}</div>` : ""}
    ${docs.map((m) => `<a class="drawer-doc" href="${mediaUrl(m, true)}" download>${summaryHtml(m)}${m.media.name ? ` · ${escapeHtml(m.media.name)}` : ""}</a>`).join("")}`;
}

function atendimentoInfo(s) {
  const handler = userById(s.handler_user_id);
  const rows = [
    ["Situação", s.ai_paused ? `Atendimento humano · ${escapeHtml(isMe(s.handler_user_id) ? "você" : handler?.name || "equipe")}` : statusOf(s) === "encerrado" ? "Encerrado" : "Na fila (IA respondendo)"],
    ["Quadro", escapeHtml(stageOf(s))],
  ];
  if (statusOf(s) === "fila") rows.push(["Esperando há", escapeHtml(fmtWait(waitingSince(s)))]);
  return rows.map(([k, v]) => `<div class="drawer-row"><span>${k}</span><span>${v}</span></div>`).join("");
}

export function renderDrawer() {
  if (drawer.hidden) return;
  const s = activeSession();
  if (!s) return toggleDrawer(false);
  const tags = new Set(s.client_tags || []);
  drawer.innerHTML = `
    <div class="drawer-head">
      <span>Dados do cliente</span>
      <button type="button" class="composer-x" data-drawer-close aria-label="Fechar">${icon("x")}</button>
    </div>
    <div class="drawer-profile">
      ${contactAvatarHtml(s, { large: true })}
      <div class="drawer-name">${escapeHtml(contactName(s))}</div>
      <div class="drawer-phone">${escapeHtml(formatPhone(s.phone))}</div>
      ${s.contact_name ? `<div class="drawer-muted">No WhatsApp: ${escapeHtml(s.contact_name)}</div>` : ""}
      ${s.client_name ? `<div class="drawer-muted">No cadastro: ${escapeHtml(s.client_name)}</div>` : ""}
    </div>
    <section class="drawer-section">
      <h3>Atendimento</h3>
      ${atendimentoInfo(s)}
      <div class="drawer-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-drawer-action="transfer">Transferir</button>
        ${s.ai_paused ? `<button type="button" class="btn btn-secondary btn-sm" data-drawer-action="release">Devolver à IA</button>` : ""}
        ${statusOf(s) !== "encerrado" ? `<button type="button" class="btn btn-secondary btn-sm" data-drawer-action="close">Encerrar</button>` : ""}
        ${isAdmin() ? `<a class="btn btn-secondary btn-sm" href="/dashboard/crm">Ver no CRM</a>` : ""}
      </div>
    </section>
    <section class="drawer-section">
      <h3>Etiquetas</h3>
      <div class="drawer-tags">${(window.Dash.tags || [])
        .map((t) => `<button type="button" class="badge tag-toggle ${tags.has(t.id) ? `badge-${t.color} is-on` : "badge-gray"}" data-tag="${escapeHtml(t.id)}" aria-pressed="${tags.has(t.id)}">${escapeHtml(t.label)}</button>`)
        .join("")}</div>
    </section>
    <section class="drawer-section">
      <h3>Mídias e documentos</h3>
      ${mediaGallery()}
    </section>`;
}

drawer.addEventListener("click", async (e) => {
  if (e.target.closest("[data-drawer-close]")) return toggleDrawer(false);
  const action = e.target.closest("[data-drawer-action]")?.dataset.drawerAction;
  if (action === "transfer") return openTransfer();
  if (action === "close") return requestClose();
  if (action === "release" && confirm("Devolver esta conversa à IA? O cliente volta para a fila de Pendentes.")) return sessionAction("release", "Devolver");

  const tagBtn = e.target.closest("[data-tag]");
  if (!tagBtn) return;
  const s = activeSession();
  const current = new Set(s.client_tags || []);
  current.has(tagBtn.dataset.tag) ? current.delete(tagBtn.dataset.tag) : current.add(tagBtn.dataset.tag);
  const tags = [...current];
  const previous = s.client_tags || [];
  setTagsLocal(s.phone, tags); // otimista
  try {
    await api(`/api/contatos/${encodeURIComponent(onlyDigits(s.phone))}/tags`, { method: "PUT", body: { tags } });
  } catch (err) {
    setTagsLocal(s.phone, previous);
    alert(err.message || "Não foi possível salvar as etiquetas.");
  }
});

/** Etiquetas mudaram (aqui ou pelo SSE "client"): vale para todas as conversas do telefone. */
export function setTagsLocal(phone, tags) {
  const digits = onlyDigits(phone);
  state.sessions.filter((s) => onlyDigits(s.phone) === digits).forEach((s) => patchSession(s.id, { client_tags: tags }));
}

// ── Transferir ───────────────────────────────────────────────────────────
const transferModal = modal("transferOverlay");

async function openTransfer() {
  try {
    state.team = (await api("/api/crm/users")).data || state.team; // quem está online agora
  } catch {
    // usa a lista que já temos
  }
  const s = activeSession();
  const load = (id) => state.sessions.filter((x) => x.ai_paused && x.handler_user_id === id).length;
  const people = state.team
    .filter((u) => u.active && u.id !== (s.ai_paused ? s.handler_user_id : null))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  el("transferList").innerHTML = people.length
    ? people.map((u) => `
      <li><button type="button" class="pick-item" data-transfer="${escapeHtml(u.id)}">
        ${avatarHtml(u)}
        <span class="pick-name">${escapeHtml(u.name)}${isMe(u.id) ? " (você)" : ""}<small>${u.role === "admin" ? "Administrador" : "Atendente"} · ${load(u.id)} em atendimento</small></span>
        <span class="pick-status ${u.online ? "is-online" : ""}">${u.online ? "online" : "offline"}</span>
      </button></li>`).join("")
    : `<li class="dash-empty">Ninguém disponível para receber.</li>`;
  el("transferErro").style.display = "none";
  transferModal.open();
}

el("transferList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-transfer]");
  if (!b) return;
  const target = userById(b.dataset.transfer);
  if (target && !target.online && !confirm(`${target.name} está offline agora. Transferir mesmo assim?`)) return;
  if (await sessionAction("transfer", "Transferir", { userId: b.dataset.transfer })) transferModal.close();
});

// ── Encerrar ─────────────────────────────────────────────────────────────
function requestClose() {
  const s = activeSession();
  if (!confirm(`Encerrar o atendimento de ${contactName(s)}?\n\nA conversa vai para "Encerrados" e o card para "Finalizado" no quadro. Se o cliente escrever de novo, ele volta para a fila e a IA responde.`)) return;
  sessionAction("close", "Encerrar");
}

// ── Encaminhar ───────────────────────────────────────────────────────────
const forwardModal = modal("forwardOverlay");
let forwarding = null;
const chosen = new Set();

function renderForwardList() {
  const q = el("forwardSearch").value.trim().toLowerCase();
  const list = visibleSessions("contatos")
    .filter((s) => !q || contactName(s).toLowerCase().includes(q) || onlyDigits(s.phone).includes(onlyDigits(q) || "§"));
  el("forwardList").innerHTML = list.length
    ? list.slice(0, 50).map((s) => `
      <li><label class="pick-item">
        <input type="checkbox" data-forward="${escapeHtml(s.id)}" ${chosen.has(s.id) ? "checked" : ""} />
        ${contactAvatarHtml(s)}
        <span class="pick-name">${escapeHtml(contactName(s))}<small>${escapeHtml(formatPhone(s.phone))}</small></span>
      </label></li>`).join("")
    : `<li class="dash-empty">Nenhuma conversa encontrada.</li>`;
}

on("forward", (m) => {
  forwarding = m;
  chosen.clear();
  el("forwardSearch").value = "";
  el("forwardErro").style.display = "none";
  renderForwardList();
  forwardModal.open();
});
el("forwardSearch").addEventListener("input", renderForwardList);
el("forwardList").addEventListener("change", (e) => {
  const cb = e.target.closest("[data-forward]");
  if (cb) cb.checked ? chosen.add(cb.dataset.forward) : chosen.delete(cb.dataset.forward);
});
el("forwardSend").addEventListener("click", async () => {
  if (!forwarding || chosen.size === 0) return;
  try {
    const { data } = await api(`/api/conversas/messages/${encodeURIComponent(forwarding.id)}/forward`, { method: "POST", body: { sessionIds: [...chosen] } });
    data.filter((r) => r.message && r.sessionId === state.activeId).forEach((r) => appendMessage(r.message));
    const failed = data.filter((r) => !r.ok);
    if (failed.length) {
      el("forwardErro").innerHTML = failed
        .map((r) => `${escapeHtml(contactName(state.sessions.find((s) => s.id === r.sessionId) || {}))}: ${escapeHtml(r.error || "falhou")}`)
        .join("<br>");
      el("forwardErro").style.display = "block";
      return;
    }
    forwardModal.close();
  } catch (err) {
    el("forwardErro").textContent = err.message;
    el("forwardErro").style.display = "block";
  }
});

on("close-request", requestClose);
on("transfer-request", openTransfer);
on("active", renderDrawer);
el("btnInfo").addEventListener("click", () => toggleDrawer());
