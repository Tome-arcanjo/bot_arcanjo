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
  canais: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3.75m8.5-3.75l1 3.75m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"/></svg>`,
  logout: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0110.5 3h6a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0116.5 21h-6a2.25 2.25 0 01-2.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/></svg>`,
  back: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>`,
};

export const NAV_ITEMS = [
  { key: "configuracoes", href: "/dashboard/configuracoes", label: "Configurações", icon: ICONS.settings },
  { key: "crm", href: "/dashboard/crm", label: "CRM", icon: ICONS.crm },
  { key: "conversas", href: "/dashboard/conversas", label: "Conversas", icon: ICONS.conversas },
  { key: "contatos", href: "/dashboard/contatos", label: "Contatos", icon: ICONS.contatos },
  { key: "canais", href: "/dashboard/canais", label: "Canais", icon: ICONS.canais },
];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {Object} opts
 * @param {string} opts.active - key do item de menu ativo (ver NAV_ITEMS)
 * @param {string} opts.title - título mostrado na barra superior
 * @param {string} opts.content - HTML do conteúdo da página (já pronto)
 * @param {string} [opts.extraHead] - tags extras para dentro do <head> (ex: <style> específico da página)
 * @param {string} [opts.topbarActions] - HTML de botões extras na barra superior, à direita
 * @param {string} [opts.bodyClass] - classes extras aplicadas ao <body>
 */
export function renderDashboardLayout({ active, title, content, extraHead = "", topbarActions = "", bodyClass = "" }) {
  const navHtml = NAV_ITEMS.map((item) => {
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
        <a href="/logout" class="dash-nav-item logout">${ICONS.logout}<span class="label">Sair</span></a>
      </div>
    </aside>

    <div class="dash-main">
      <header class="dash-topbar">
        <button type="button" class="dash-back-btn" onclick="history.length > 1 ? history.back() : (window.location.href = '/dashboard')" title="Voltar" aria-label="Voltar">
          ${ICONS.back}
        </button>
        <h1>${escapeHtml(title)}</h1>
        <div class="dash-topbar-actions">${topbarActions}</div>
      </header>
      <main class="dash-content">
        ${content}
      </main>
    </div>
  </div>
</body>
</html>`;
}
