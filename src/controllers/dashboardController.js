import { getDb } from "../database/db.js";
import { renderDashboardLayout, inlineJson } from "../views/dashboardLayout.js";
import { CRM_COLUMNS } from "../constants/crm.js";

// GET /dashboard — aterrissagem padrão pós-login: manda pra Conversas.
export function dashboardRoot(req, res) {
  res.redirect("/dashboard/conversas");
}

// ── Configurações (personalidade do bot) ──────────────────────────────
export function configuracoesView(req, res) {
  const content = `
    <div class="dash-card" style="padding:28px 32px; max-width:760px;">
      <p style="color:var(--text-secondary); font-size:0.88rem; margin:0 0 20px;">
        Este texto define como o Arcanjo se comporta — vale tanto para o chat web quanto para o WhatsApp.
      </p>
      <label class="field-label" for="systemPromptInput">Personalidade / instruções do bot</label>
      <textarea id="systemPromptInput" class="field-textarea" rows="12" placeholder="Descreva como o bot deve se comportar..."></textarea>

      <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
        <span style="font-size:0.78rem; color:var(--text-muted); align-self:center;">Presets:</span>
        <button type="button" class="btn btn-secondary preset-btn" data-preset="Você é o assistente virtual de um escritório de advocacia trabalhista. Seu único papel é fazer o atendimento inicial (triagem) dos clientes pelo WhatsApp — você NÃO é advogado e NÃO deve, em nenhuma hipótese, dar conselhos jurídicos, opinar sobre chances de sucesso de um caso, interpretar leis ou sugerir o que o cliente deve fazer juridicamente.

O que você deve fazer:
- Cumprimentar o cliente de forma breve e cordial.
- Perguntar e anotar o que ele precisa: nome, um resumo do problema/situação, e a melhor forma/horário de contato, se relevante.
- Ser direto e objetivo — respostas curtas, sem enrolação, sem repetir informação.
- Demonstrar empatia com a situação, sem prometer resultados nem opinar sobre o caso.

O que você NUNCA deve fazer:
- Dar orientação jurídica de qualquer tipo (o que fazer, prazos, direitos, valores, chances de ganhar).
- Interpretar ou explicar leis, mesmo que perguntado diretamente.
- Fingir ser advogado ou falar como se fosse um.

Se o cliente perguntar algo jurídico, responda de forma parecida com: 'Essa parte é com o advogado responsável — já anotei tudo aqui e ele vai te orientar assim que possível.' e continue coletando as informações que faltarem.

Responda sempre em português, de forma breve.">Triagem (recomendado)</button>
        <button type="button" class="btn btn-secondary preset-btn" data-preset="Você é o Arcanjo, um assistente inteligente, prestativo e amigável. Responda sempre em português.">Padrão</button>
      </div>

      <div style="margin-top:24px; display:flex; align-items:center; gap:12px;">
        <button type="button" class="btn btn-primary" id="btnSavePrompt">Salvar</button>
        <span id="saveStatus" style="font-size:0.82rem; color:var(--success); display:none;">Salvo com sucesso ✓</span>
      </div>
    </div>

    <script src="/js/dashboard-configuracoes.js"></script>
  `;

  res.send(renderDashboardLayout({ active: "configuracoes", title: "Configurações", content, user: req.session.user }));
}

// ── Canais (histórico bruto de mensagens — antigo /admin) ─────────────
export async function canaisView(req, res) {
  try {
    const db = getDb();

    const { data: messages, error } = await db
      .from("messages")
      .select(`
        id, role, content, created_at,
        sessions ( id, title, provider, phone )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const { count: totalMessages } = await db.from("messages").select("id", { count: "exact", head: true });
    const { count: totalSessions } = await db.from("sessions").select("id", { count: "exact", head: true });
    const { count: whatsappSessions } = await db
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .not("phone", "is", null);

    const rows = (messages || []).map((m) => {
      const session = m.sessions || {};
      const origin = session.phone ? `📱 ${session.phone}` : `💻 ${session.title || "Web"}`;
      const roleBadge = m.role === "user"
        ? `<span class="badge badge-blue">Cliente</span>`
        : m.role === "human"
          ? `<span class="badge badge-green">Equipe</span>`
          : `<span class="badge badge-gold">Bot</span>`;
      const date = new Date(m.created_at).toLocaleString("pt-BR");
      const preview = (m.content || "").substring(0, 300).replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<tr><td>${date}</td><td>${roleBadge}</td><td>${origin}</td><td style="max-width:480px; white-space:pre-wrap; word-break:break-word;">${preview}</td></tr>`;
    }).join("");

    const content = `
      <div class="dash-stats">
        <div class="dash-stat-card"><div class="number">${totalMessages || 0}</div><div class="label">Total de Mensagens</div></div>
        <div class="dash-stat-card"><div class="number">${totalSessions || 0}</div><div class="label">Sessões Totais</div></div>
        <div class="dash-stat-card"><div class="number">${whatsappSessions || 0}</div><div class="label">Sessões WhatsApp</div></div>
      </div>
      <div class="dash-card dash-table-wrapper">
        <table class="dash-table">
          <thead><tr><th>Data/Hora</th><th>Origem</th><th>Canal</th><th>Mensagem</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="dash-empty">Nenhuma mensagem ainda.</td></tr>`}</tbody>
        </table>
      </div>
    `;

    const topbarActions = `<a href="/dashboard/canais" class="btn btn-secondary">↺ Atualizar</a>`;
    res.send(renderDashboardLayout({ active: "canais", title: "Canais", content, topbarActions, user: req.session.user }));
  } catch (error) {
    console.error("[Canais] Erro ao carregar:", error.message);
    res.status(500).send(`<pre>Erro: ${error.message}</pre>`);
  }
}

// ── CRM (kanban com drag-and-drop) ─────────────────────────────────────
export function crmView(req, res) {
  const content = `
    <div id="crmCallAlert" class="crm-call-alert" style="display:none;" role="alert"></div>
    <div class="crm-toolbar">
      <div class="crm-filters" id="crmFilters" role="group" aria-label="Filtrar casos">
        <button type="button" class="crm-filter" data-filter="all">Todos</button>
        <button type="button" class="crm-filter" data-filter="mine">Meus casos</button>
        <button type="button" class="crm-filter" data-filter="unassigned">Sem responsável</button>
      </div>
      <span class="crm-live" id="crmLive" title="O quadro se atualiza sozinho quando alguém da equipe mexe em um caso">Conectando...</span>
    </div>
    <div id="crmBoard" class="crm-board">
      <p class="dash-empty">Carregando casos...</p>
    </div>
    <div class="crm-toasts" id="crmToasts" aria-live="polite"></div>
    <div class="crm-assign-menu" id="crmAssignMenu" role="menu" hidden></div>

    <div class="modal-overlay" id="historicoOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="historicoTitulo">
        <div class="modal-header">
          <h2 id="historicoTitulo">Histórico do caso</h2>
          <button type="button" class="modal-close" id="historicoClose" aria-label="Fechar">✕</button>
        </div>
        <div class="modal-body">
          <p id="historicoCliente" style="margin:0 0 12px; font-size:0.86rem; color:var(--text-secondary);"></p>
          <ol class="crm-history" id="historicoLista"></ol>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="novoCasoOverlay">
      <div class="modal-card">
        <div class="modal-header">
          <h2>Novo caso</h2>
          <button type="button" class="modal-close" id="novoCasoClose">✕</button>
        </div>
        <div class="modal-body">
          <label class="field-label" for="novoCasoPhone">Telefone (WhatsApp) *</label>
          <input type="text" id="novoCasoPhone" class="field-input" placeholder="+55 11 99999-9999" />

          <label class="field-label" for="novoCasoNome" style="margin-top:14px;">Nome do cliente</label>
          <input type="text" id="novoCasoNome" class="field-input" placeholder="Nome completo" />

          <label class="field-label" for="novoCasoResumo" style="margin-top:14px;">Resumo do caso</label>
          <textarea id="novoCasoResumo" class="field-textarea" rows="4" placeholder="Breve descrição do caso..."></textarea>

          <p id="novoCasoErro" class="modal-error" style="display:none;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="novoCasoCancelar">Cancelar</button>
          <button type="button" class="btn btn-primary" id="novoCasoSalvar">Criar caso</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="ligacaoOverlay">
      <div class="modal-card">
        <div class="modal-header">
          <h2 id="ligacaoTitulo">Agendar ligação</h2>
          <button type="button" class="modal-close" id="ligacaoClose">✕</button>
        </div>
        <div class="modal-body">
          <p id="ligacaoCliente" style="margin:0 0 14px; font-size:0.86rem; color:var(--text-secondary);"></p>
          <label class="field-label" for="ligacaoDataHora">Data e hora da ligação *</label>
          <input type="datetime-local" id="ligacaoDataHora" class="field-input" />
          <p id="ligacaoAviso" style="display:none; margin:12px 0 0; font-size:0.8rem; color:var(--text-secondary);">
            O cliente será avisado pelo WhatsApp de que o horário foi alterado.
          </p>
          <p id="ligacaoErro" class="modal-error" style="display:none;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="ligacaoCancelar">Fechar</button>
          <button type="button" class="btn btn-primary" id="ligacaoSalvar">Agendar</button>
        </div>
      </div>
    </div>

    <script src="/js/dashboard-crm.js"></script>
  `;
  const topbarActions = `<button type="button" class="btn btn-primary" id="btnNovoCaso">+ Novo caso</button>`;
  res.send(renderDashboardLayout({
    active: "crm",
    title: "CRM",
    content,
    topbarActions,
    // Colunas vêm do servidor (src/constants/crm.js), a mesma lista que valida o status.
    extraHead: `<link rel="stylesheet" href="/css/dashboard-crm.css" />
  <script>window.CRM_COLUMNS = ${inlineJson(CRM_COLUMNS)};</script>`,
    hideBack: true,
    user: req.session.user,
  }));
}

// ── Conversas (inbox por cliente) ──────────────────────────────────────
export function conversasView(req, res) {
  const content = `
    <div class="conversas-layout">
      <aside class="conversas-list" id="conversasList">
        <p class="dash-empty">Carregando conversas...</p>
      </aside>
      <section class="conversas-main">
        <header class="thread-header" id="threadHeader" hidden>
          <div class="thread-who">
            <div class="thread-title" id="threadTitle"></div>
            <div class="thread-sub" id="threadSub"></div>
          </div>
          <span class="badge" id="threadStatus"></span>
          <div class="thread-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="btnAssumir" hidden>Assumir</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btnDevolver" hidden>Devolver à IA</button>
          </div>
        </header>
        <div class="thread-presence" id="threadPresence" role="status" hidden></div>
        <div class="conversas-thread" id="conversasThread">
          <p class="dash-empty">Selecione uma conversa à esquerda.</p>
        </div>
        <div class="thread-window" id="threadWindow" role="status" hidden></div>
        <form class="thread-composer" id="threadComposer" hidden>
          <div class="thread-composer-row">
            <textarea id="composerInput" class="field-textarea" rows="1" maxlength="4096"
              placeholder="Escreva uma mensagem…  (Enter envia, Shift+Enter quebra a linha)"></textarea>
            <button type="submit" class="btn btn-primary" id="composerSend">Enviar</button>
          </div>
          <div class="thread-composer-hint" id="composerHint"></div>
        </form>
      </section>
    </div>
    <script src="/js/dashboard-conversas.js"></script>
  `;
  res.send(renderDashboardLayout({
    active: "conversas",
    title: "Conversas",
    content,
    extraHead: `<link rel="stylesheet" href="/css/dashboard-conversas.css" />`,
    bodyClass: "no-content-scroll",
    user: req.session.user,
  }));
}

// ── Contatos (cadastro de clientes) ────────────────────────────────────
export function contatosView(req, res) {
  const content = `
    <div style="margin-bottom:16px; max-width:420px;">
      <input type="search" id="contatosSearch" class="field-input" placeholder="Buscar por nome, telefone ou e-mail..." />
    </div>
    <div class="dash-card dash-table-wrapper">
      <table class="dash-table">
        <thead>
          <tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Endereço</th><th>Nascimento</th><th>Atualizado em</th></tr>
        </thead>
        <tbody id="contatosTbody">
          <tr><td colspan="6" class="dash-empty">Carregando contatos...</td></tr>
        </tbody>
      </table>
    </div>
    <script src="/js/dashboard-contatos.js"></script>
  `;
  res.send(renderDashboardLayout({ active: "contatos", title: "Contatos", content, user: req.session.user }));
}

// ── Usuários (somente admin — ver requireAdmin em server.js) ───────────
export function usuariosView(req, res) {
  const content = `
    <p style="color:var(--text-secondary); font-size:0.86rem; margin:0 0 16px; max-width:760px;">
      Cada pessoa da equipe entra com o próprio e-mail e senha. <strong>Administradores</strong> gerenciam usuários,
      excluem casos e editam a personalidade do bot; <strong>atendentes</strong> fazem todo o resto.
      Quem já tem histórico no sistema é desativado em vez de excluído.
    </p>
    <div class="dash-card dash-table-wrapper">
      <table class="dash-table usuarios-table">
        <thead>
          <tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Criado em</th><th></th></tr>
        </thead>
        <tbody id="usuariosTbody">
          <tr><td colspan="6" class="dash-empty">Carregando usuários...</td></tr>
        </tbody>
      </table>
    </div>

    <div class="modal-overlay" id="usuarioOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="usuarioTitulo">
        <div class="modal-header">
          <h2 id="usuarioTitulo">Novo usuário</h2>
          <button type="button" class="modal-close" data-close aria-label="Fechar">✕</button>
        </div>
        <form id="usuarioForm" autocomplete="off">
          <div class="modal-body">
            <label class="field-label" for="usuarioNome">Nome *</label>
            <input type="text" id="usuarioNome" class="field-input" maxlength="100" required />

            <label class="field-label" for="usuarioEmail" style="margin-top:14px;">E-mail *</label>
            <input type="email" id="usuarioEmail" class="field-input" maxlength="200" required />

            <label class="field-label" for="usuarioPapel" style="margin-top:14px;">Papel</label>
            <select id="usuarioPapel" class="field-input">
              <option value="atendente">Atendente</option>
              <option value="admin">Administrador</option>
            </select>

            <div id="usuarioSenhaWrap">
              <label class="field-label" for="usuarioSenha" style="margin-top:14px;">Senha inicial *</label>
              <input type="password" id="usuarioSenha" class="field-input" minlength="8" autocomplete="new-password" />
              <p class="modal-hint">Pelo menos 8 caracteres. Passe para a pessoa e peça que ela troque em "Minha conta".</p>
            </div>

            <p id="usuarioErro" class="modal-error" style="display:none;"></p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary" id="usuarioSalvar">Criar usuário</button>
          </div>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="senhaOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="senhaTitulo">
        <div class="modal-header">
          <h2 id="senhaTitulo">Redefinir senha</h2>
          <button type="button" class="modal-close" data-close aria-label="Fechar">✕</button>
        </div>
        <form id="senhaForm" autocomplete="off">
          <div class="modal-body">
            <p id="senhaQuem" style="margin:0 0 14px; font-size:0.86rem; color:var(--text-secondary);"></p>
            <label class="field-label" for="senhaNova">Nova senha *</label>
            <input type="password" id="senhaNova" class="field-input" minlength="8" autocomplete="new-password" required />
            <p class="modal-hint">A pessoa será desconectada de todos os dispositivos.</p>
            <p id="senhaErro" class="modal-error" style="display:none;"></p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary" id="senhaSalvar">Redefinir</button>
          </div>
        </form>
      </div>
    </div>

    <script src="/js/dashboard-usuarios.js"></script>
  `;
  const topbarActions = `<button type="button" class="btn btn-primary" id="btnNovoUsuario">+ Novo usuário</button>`;
  res.send(renderDashboardLayout({
    active: "usuarios",
    title: "Usuários",
    content,
    topbarActions,
    extraHead: `<link rel="stylesheet" href="/css/dashboard-usuarios.css" />`,
    user: req.session.user,
  }));
}

// Página de "acesso restrito" no layout do painel (usada por requireAdmin).
export function forbiddenView(req, res) {
  const content = `<div class="dash-card"><p class="dash-empty">Esta área é restrita a administradores.</p></div>`;
  res.status(403).send(renderDashboardLayout({ active: "", title: "Acesso restrito", content, user: req.session.user }));
}
