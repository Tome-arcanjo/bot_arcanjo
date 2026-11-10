/**
 * Helpers compartilhados pelas telas do painel. Carregado no <head> por
 * src/views/dashboardLayout.js, antes dos scripts de cada página.
 *
 * window.Dash.me é o usuário logado ({ id, name, email, role, emergency? }),
 * injetado pelo layout.
 */
(function () {
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /** Ícone de linha (traços de src/views/icons.js, injetados pelo layout). */
  function icon(name, cls) {
    const paths = (window.Dash.icons || {})[name] || "";
    return `<svg class="icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  }

  // "Ana Souza" -> "AS"; "bia" -> "B"
  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  /** Avatar com iniciais; `user` null = "sem responsável". */
  function avatarHtml(user, opts) {
    const size = opts && opts.small ? " avatar-sm" : "";
    if (!user) {
      return `<span class="avatar avatar-empty${size}" title="Sem responsável">–</span>`;
    }
    const me = window.Dash.me && user.id && user.id === window.Dash.me.id ? " is-me" : "";
    return `<span class="avatar${size}${me}" title="${escapeHtml(user.name)}">${escapeHtml(initials(user.name))}</span>`;
  }

  // "5511999999999" -> "+55 11 99999-9999" (outros países: "+" e os dígitos)
  function formatPhone(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    const br = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    if (br) return `+55 ${br[1]} ${br[2]}-${br[3]}`;
    return d ? "+" + d : "";
  }

  /**
   * Nome do cliente de uma conversa: o do perfil do WhatsApp (contact_name),
   * senão o do cadastro (client_name), senão o telefone.
   */
  function contactName(s) {
    if (!s) return "";
    return s.contact_name || s.client_name || formatPhone(s.phone) || s.title || "Conversa";
  }

  /**
   * Avatar do cliente: iniciais do nome com uma cor fixa por telefone (a API
   * oficial do WhatsApp não fornece a foto de perfil). Sem nome, ícone de pessoa.
   */
  function contactAvatarHtml(s, opts) {
    const size = opts && opts.large ? " avatar-lg" : "";
    const seed = String((s && (s.phone || s.id)) || "");
    // FNV-1a + mistura final: telefones quase iguais ganham cores bem diferentes.
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = (hash ^ (hash >>> 13)) >>> 0;
    const name = s && (s.contact_name || s.client_name);
    const text = name ? escapeHtml(initials(name)) : icon("user");
    return `<span class="avatar avatar-contact${size}" style="--avatar-hue:${hash % 360}" aria-hidden="true">${text}</span>`;
  }

  // "há 5 min", "há 2 h", "ontem", "12/03 14:20"
  function timeAgo(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return "";
    const min = Math.floor(ms / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    if (h < 48) return "ontem";
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  // Etiquetas jurídicas (src/constants/tags.js, injetadas pelo layout).
  function tagById(id) {
    return (window.Dash.tags || []).find((t) => t.id === id) || null;
  }

  /** Chips das etiquetas do cliente; `max` mostra só as primeiras + "+N". */
  function tagsHtml(ids, opts) {
    const list = (ids || []).map(tagById).filter(Boolean);
    const max = opts && opts.max;
    const shown = max ? list.slice(0, max) : list;
    const more = max && list.length > max ? `<span class="badge badge-gray">+${list.length - max}</span>` : "";
    return shown.map((t) => `<span class="badge badge-${t.color} tag-chip">${escapeHtml(t.label)}</span>`).join("") + more;
  }

  // Corpos enviados como estão (arquivos); o resto vira JSON.
  const isRawBody = (b) => typeof b === "string" || b instanceof Blob || b instanceof FormData || b instanceof ArrayBuffer;

  /** fetch JSON no padrão { success, data, error } das APIs do painel. */
  async function api(url, options) {
    const opts = Object.assign({ headers: {} }, options);
    if (opts.body !== undefined && !isRawBody(opts.body)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      // Sessão encerrada (logout, usuário desativado, senha trocada).
      window.location.href = "/login";
      throw new Error("Sessão encerrada. Faça login novamente.");
    }
    let json = {};
    try {
      json = await res.json();
    } catch {
      // resposta sem corpo JSON
    }
    if (!res.ok || json.success === false) {
      // status/code/body ajudam a tela a tratar casos como HANDLED_BY_OTHER.
      throw Object.assign(new Error(json.error || `Erro ${res.status}`), { status: res.status, code: json.code, body: json });
    }
    return json;
  }

  window.Dash = Object.assign(window.Dash || {}, {
    icon,
    escapeHtml,
    initials,
    avatarHtml,
    formatPhone,
    contactName,
    contactAvatarHtml,
    tagById,
    tagsHtml,
    timeAgo,
    api,
  });
})();
