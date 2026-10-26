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

  /** fetch JSON no padrão { success, data, error } das APIs do painel. */
  async function api(url, options) {
    const opts = Object.assign({ headers: {} }, options);
    if (opts.body !== undefined && typeof opts.body !== "string") {
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
      throw new Error(json.error || `Erro ${res.status}`);
    }
    return json;
  }

  window.Dash = Object.assign(window.Dash || {}, { escapeHtml, initials, avatarHtml, timeAgo, api });
})();
