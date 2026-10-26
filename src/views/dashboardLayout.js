/**
 * Layout compartilhado do painel (dashboard) pós-login. Todas as telas
 * internas (Configurações, CRM, Conversas, Contatos, Canais) usam esta
 * mesma casca: sidebar fixa + barra superior com botão de voltar + área
 * de conteúdo. Isso garante uma navegação consistente e permite ir
 * livremente entre as seções, sempre com a sidebar visível.
 */

const ICONS = {
  settings: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  crm: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 4.5H3.75a.75.75 0 00-.75.75v14.25c0 .414.336.75.75.75H9m0-15.75h5.25m-5.25 0v15.75m5.25-15.75h5.25a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75H14.25m0-12v12"/></svg>`,
  conversas: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm3.75 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm3.75 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>`,
  contatos: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>`,
  usuarios: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>`,
  canais: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3.75m8.5-3.75l1 3.75m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"/></svg>`,
  logout: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0110.5 3h6a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0116.5 21h-6a2.25 2.25 0 01-2.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/></svg>`,
  back: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>`,
};

// adminOnly: o item só aparece para administradores (as rotas também são
// protegidas por requireAdmin — esconder o link é só conveniência).
export const NAV_ITEMS = [
  { key: "configuracoes", href: "/dashboard/configuracoes", label: "Configurações", icon: ICONS.settings, adminOnly: true },
  { key: "crm", href: "/dashboard/crm", label: "Dashboard", icon: ICONS.crm },
  { key: "conversas", href: "/dashboard/conversas", label: "Conversas", icon: ICONS.conversas },
  { key: "contatos", href: "/dashboard/contatos", label: "Contatos", icon: ICONS.contatos },
  { key: "canais", href: "/dashboard/canais", label: "Canais", icon: ICONS.canais },
  { key: "usuarios", href: "/dashboard/usuarios", label: "Usuários", icon: ICONS.usuarios, adminOnly: true },
];

const ROLE_LABELS = { admin: "Administrador", atendente: "Atendente" };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// U+2028/U+2029 são válidos em JSON mas quebram uma string JS dentro de <script>.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

// JSON seguro para colocar dentro de <script> (não deixa um nome como
// "</script>" fechar a tag).
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function userChipHtml(user) {
  if (!user) return "";
  const role = user.emergency ? "Acesso de emergência" : ROLE_LABELS[user.role] || user.role;
  return `<button type="button" class="dash-user-chip" id="dashUserChip" title="Minha conta">
          <span class="avatar is-me">${escapeHtml(initials(user.name))}</span>
          <span class="who"><span class="name">${escapeHtml(user.name)}</span><span class="role">${escapeHtml(role)}</span></span>
        </button>`;
}

// Modal "Minha conta" (trocar a própria senha) — presente em todas as telas.
function accountModalHtml(user) {
  if (!user) return "";
  const body = user.emergency
    ? `<p style="margin:0; font-size:0.86rem; color:var(--text-secondary);">
         Você entrou com o acesso de emergência do servidor. A senha dele é definida no arquivo <code>.env</code>
         (ADMIN_PASSWORD_HASH) e não pode ser trocada pelo painel.
       </p>`
    : `<p style="margin:0 0 16px; font-size:0.86rem; color:var(--text-secondary);">${escapeHtml(user.name)} · ${escapeHtml(user.email || "")}</p>
       <form id="accountForm" autocomplete="on">
         <label class="field-label" for="accountCurrent">Senha atual</label>
         <input type="password" id="accountCurrent" class="field-input" autocomplete="current-password" required />
         <label class="field-label" for="accountNew" style="margin-top:14px;">Nova senha</label>
         <input type="password" id="accountNew" class="field-input" autocomplete="new-password" minlength="8" required />
         <label class="field-label" for="accountConfirm" style="margin-top:14px;">Confirmar nova senha</label>
         <input type="password" id="accountConfirm" class="field-input" autocomplete="new-password" minlength="8" required />
         <p class="modal-hint">Pelo menos 8 caracteres. Os outros dispositivos conectados com a sua conta serão desconectados.</p>
         <p id="accountError" class="modal-error" style="display:none;"></p>
         <p id="accountSuccess" class="modal-success" style="display:none;">Senha alterada.</p>
       </form>`;
  const footer = user.emergency
    ? `<button type="button" class="btn btn-secondary" data-account-close>Fechar</button>`
    : `<button type="button" class="btn btn-secondary" data-account-close>Fechar</button>
       <button type="submit" form="accountForm" class="btn btn-primary" id="accountSave">Trocar senha</button>`;
  return `<div class="modal-overlay" id="accountOverlay">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
      <div class="modal-header">
        <h2 id="accountTitle">Minha conta</h2>
        <button type="button" class="modal-close" data-account-close aria-label="Fechar">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">${footer}</div>
    </div>
  </div>`;
}

/**
 * @param {Object} opts
 * @param {string} opts.active - key do item de menu ativo (ver NAV_ITEMS)
 * @param {string} opts.title - título mostrado na barra superior
 * @param {string} opts.content - HTML do conteúdo da página (já pronto)
 * @param {string} [opts.extraHead] - tags extras para dentro do <head> (ex: <style> específico da página)
 * @param {string} [opts.topbarActions] - HTML de botões extras na barra superior, à direita
 * @param {string} [opts.bodyClass] - classes extras aplicadas ao <body>
 * @param {boolean} [opts.hideBack] - se true, omite o botão de voltar da topbar
 * @param {Object} [opts.user] - usuário logado (req.session.user)
 */
export function renderDashboardLayout({ active, title, content, extraHead = "", topbarActions = "", bodyClass = "", hideBack = false, user = null }) {
  const isAdmin = user?.role === "admin";
  const navHtml = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
    const activeClass = item.key === active ? " active" : "";
    return `<a href="${item.href}" class="dash-nav-item${activeClass}">${item.icon}<span class="label">${escapeHtml(item.label)}</span></a>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(title)} — Miguel Arcanjo Advocacia</title>
  <link rel="icon" href="/img/symbol-gold.png" />
  <link rel="stylesheet" href="/css/brand.css" />
  <link rel="stylesheet" href="/css/dashboard-alerts.css" />
  <script>window.Dash = { me: ${inlineJson(user)} };</script>
  <script src="/js/dashboard-common.js"></script>
  ${extraHead}
</head>
<body class="dashboard-body ${bodyClass}">
  <div class="dash-shell">
    <aside class="dash-sidebar">
      <div class="dash-sidebar-logo">
        <img src="/img/logo-white.png" alt="Miguel Arcanjo Advocacia" />
      </div>
      <nav class="dash-nav">
        ${navHtml}
      </nav>
      <div class="dash-sidebar-footer">
        ${userChipHtml(user)}
        <a href="/logout" class="dash-nav-item logout">${ICONS.logout}<span class="label">Sair</span></a>
      </div>
    </aside>

    <div class="dash-main">
      ${user?.emergency
        ? `<div class="dash-emergency-banner" role="status">Você entrou com o <strong>acesso de emergência</strong>. Cadastre a equipe em <a href="/dashboard/usuarios">Usuários</a> e use o login individual no dia a dia.</div>`
        : ""}
      <header class="dash-topbar">
        ${hideBack ? `` : `<button type="button" class="dash-back-btn" onclick="window.location.href = '/dashboard/crm'" title="Voltar" aria-label="Voltar">${ICONS.back}</button>`}
        <h1>${escapeHtml(title)}</h1>
        <div class="dash-topbar-actions">${topbarActions}</div>
      </header>
      <main class="dash-content">
        ${content}
      </main>
    </div>
  </div>
  ${accountModalHtml(user)}
  <script src="/js/dashboard-account.js"></script>
  <script src="/js/dashboard-call-alerts.js"></script>
</body>
</html>`;
}
