import { getDb } from "../database/db.js";
import { renderDashboardLayout, inlineJson } from "../views/dashboardLayout.js";
import { iconSvg } from "../views/icons.js";
import { CRM_COLUMNS } from "../constants/crm.js";
import { ATENDIMENTO_COLUMNS } from "../constants/atendimento.js";
import { listConversations } from "../services/chatService.js";
import { listTeam } from "../services/usersService.js";
import { isUserOnline } from "../utils/sse.js";

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
        <span id="saveStatus" style="font-size:0.82rem; color:var(--success); display:none;">${iconSvg("check")} Salvo com sucesso</span>
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
      const origin = session.phone ? `${iconSvg("smartphone")} ${session.phone}` : `${iconSvg("monitor")} ${session.title || "Web"}`;
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

    const topbarActions = `<a href="/dashboard/canais" class="btn btn-secondary">${iconSvg("refresh")}Atualizar</a>`;
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
          <button type="button" class="modal-close" id="historicoClose" aria-label="Fechar">${iconSvg("x")}</button>
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
          <button type="button" class="modal-close" id="novoCasoClose">${iconSvg("x")}</button>
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
          <button type="button" class="modal-close" id="ligacaoClose">${iconSvg("x")}</button>
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

// Dados iniciais das telas de Conversas e Atendimento, já no HTML: a lista
// aparece sem esperar a primeira chamada à API. Se falhar, a tela busca sozinha.
async function conversationsBoot(page) {
  try {
    const [conversations, team] = await Promise.all([listConversations(), listTeam()]);
    return { conversations, team: team.map((u) => ({ ...u, online: isUserOnline(u.id) })) };
  } catch (error) {
    console.error(`[${page}] Erro ao carregar os dados iniciais:`, error.message);
    return null;
  }
}

// ── Atendimento (quadro de clientes do WhatsApp, com drag-and-drop) ────
export async function atendimentoView(req, res) {
  const content = `
    <div class="crm-toolbar">
      <div class="crm-filters" id="atFilters" role="group" aria-label="Filtrar clientes">
        <button type="button" class="crm-filter" data-filter="all">Todos</button>
        <button type="button" class="crm-filter" data-filter="mine">Meus atendimentos</button>
        <button type="button" class="crm-filter" data-filter="unassigned">Sem atendente</button>
      </div>
      <input type="search" id="atSearch" class="field-input at-search" placeholder="Buscar por nome ou telefone..." aria-label="Buscar cliente" />
      <span class="crm-live" id="atLive" title="O quadro se atualiza sozinho quando chega mensagem ou alguém da equipe move um cliente">Conectando...</span>
    </div>
    <div id="atBoard" class="crm-board at-board">
      <p class="dash-empty">Carregando clientes...</p>
    </div>
    <div class="crm-toasts" id="atToasts" aria-live="polite"></div>
    <script src="/js/dashboard-atendimento.js"></script>
  `;
  res.send(renderDashboardLayout({
    active: "atendimento",
    title: "Atendimento",
    content,
    // Colunas vêm do servidor (src/constants/atendimento.js), a mesma lista que valida a etapa.
    extraHead: `<link rel="stylesheet" href="/css/dashboard-crm.css" />
  <link rel="stylesheet" href="/css/dashboard-atendimento.css" />
  <script>window.ATENDIMENTO_COLUMNS = ${inlineJson(ATENDIMENTO_COLUMNS)};
  window.CONVERSAS_BOOT = ${inlineJson(await conversationsBoot("Atendimento"))};</script>`,
    hideBack: true,
    user: req.session.user,
  }));
}

// ── Conversas (estilo WhatsApp: abas, fila, anexos, ações nas mensagens) ─
export async function conversasView(req, res) {
  const content = `
    <div class="conversas-layout" id="conversasLayout">
      <aside class="conversas-sidebar">
        <div class="conv-tabs" id="convTabs" role="tablist" aria-label="Conversas">
          <button type="button" class="conv-tab" role="tab" data-tab="chats">Chats <span class="conv-tab-count"></span></button>
          <button type="button" class="conv-tab" role="tab" data-tab="pendentes">Pendentes <span class="conv-tab-count"></span></button>
          <button type="button" class="conv-tab" role="tab" data-tab="contatos">Contatos <span class="conv-tab-count"></span></button>
        </div>
        <div class="conv-tools">
          <input type="search" id="convSearch" class="field-input" placeholder="Buscar nome, telefone ou etiqueta" aria-label="Buscar conversa" />
          <div class="conv-tools-row">
            <select id="convSort" class="field-input" aria-label="Ordenar"></select>
            <select id="convTagFilter" class="field-input" aria-label="Filtrar por etiqueta"></select>
          </div>
        </div>
        <div class="conversas-list" id="conversasList" role="list">
          <p class="dash-empty">Carregando conversas...</p>
        </div>
      </aside>

      <section class="conversas-main">
        <header class="thread-header" id="threadHeader" hidden>
          <button type="button" class="thread-who-btn" id="btnInfo" title="Dados do cliente">
            <span class="thread-avatar" id="threadAvatar"></span>
            <span class="thread-who">
              <span class="thread-title" id="threadTitle"></span>
              <span class="thread-sub" id="threadSub"></span>
            </span>
          </button>
          <span class="badge" id="threadStatus"></span>
          <div class="thread-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="btnAssumir" hidden>Assumir</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btnTransferir">Transferir</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btnDevolver" hidden>Devolver à IA</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btnEncerrar">Encerrar</button>
          </div>
        </header>
        <div class="thread-presence" id="threadPresence" role="status" hidden></div>
        <div class="conversas-thread" id="conversasThread">
          <p class="dash-empty">Selecione uma conversa à esquerda.</p>
        </div>
        <div class="thread-window" id="threadWindow" role="status" hidden></div>
        <form class="thread-composer" id="threadComposer" hidden>
          <div class="composer-reply" id="composerReply" hidden></div>
          <div class="composer-files" id="composerFiles" hidden></div>
          <div class="composer-recording" id="composerRecording" hidden>
            <button type="button" class="composer-icon" id="recCancel" title="Descartar" aria-label="Descartar áudio">${iconSvg("trash")}</button>
            <span class="rec-dot"></span><span id="recTime">0:00</span>
            <span class="rec-label">Gravando áudio…</span>
            <button type="button" class="composer-send" id="recSend" title="Enviar áudio" aria-label="Enviar áudio">${iconSvg("send")}</button>
          </div>
          <div class="thread-composer-row" id="composerRow">
            <button type="button" class="composer-icon" id="btnAttach" title="Anexar arquivos" aria-label="Anexar arquivos">${iconSvg("paperclip")}</button>
            <button type="button" class="composer-icon" id="btnEmoji" title="Emojis e figurinhas" aria-label="Emojis e figurinhas">${iconSvg("sticker")}</button>
            <input type="file" id="fileInput" multiple hidden />
            <textarea id="composerInput" class="field-textarea" rows="1" maxlength="4096"
              placeholder="Escreva uma mensagem…  (Enter envia, Shift+Enter quebra a linha)"></textarea>
            <button type="button" class="composer-icon" id="btnMic" title="Gravar áudio" aria-label="Gravar áudio">${iconSvg("mic")}</button>
            <button type="submit" class="composer-send" id="composerSend" title="Enviar" aria-label="Enviar" hidden>${iconSvg("send")}</button>
          </div>
          <div class="emoji-panel" id="emojiPanel" hidden>
            <div class="emoji-tabs">
              <button type="button" class="emoji-tab active" data-panel="emojis">${iconSvg("smile")}Emojis</button>
              <button type="button" class="emoji-tab" data-panel="stickers">${iconSvg("sticker")}Figurinhas</button>
            </div>
            <div class="emoji-grid" id="emojiGrid"></div>
            <div class="sticker-grid" id="stickerGrid" hidden></div>
          </div>
          <div class="thread-composer-hint" id="composerHint"></div>
        </form>
      </section>

      <aside class="contact-drawer" id="contactDrawer" hidden aria-label="Dados do cliente"></aside>
    </div>

    <div class="msg-menu" id="msgMenu" role="menu" hidden></div>

    <div class="modal-overlay" id="transferOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="transferTitle">
        <div class="modal-header">
          <h2 id="transferTitle">Transferir atendimento</h2>
          <button type="button" class="modal-close" data-close aria-label="Fechar">${iconSvg("x")}</button>
        </div>
        <div class="modal-body">
          <p class="modal-hint" style="margin-top:0;">A conversa passa para a pessoa escolhida e a IA fica pausada. O quadro de Atendimento atualiza na hora.</p>
          <ul class="pick-list" id="transferList"></ul>
          <p id="transferErro" class="modal-error" style="display:none;"></p>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="forwardOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="forwardTitle">
        <div class="modal-header">
          <h2 id="forwardTitle">Encaminhar mensagem</h2>
          <button type="button" class="modal-close" data-close aria-label="Fechar">${iconSvg("x")}</button>
        </div>
        <div class="modal-body">
          <input type="search" id="forwardSearch" class="field-input" placeholder="Buscar conversa..." />
          <ul class="pick-list pick-list-check" id="forwardList"></ul>
          <p id="forwardErro" class="modal-error" style="display:none;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="forwardSend">Encaminhar</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="editOverlay">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="editTitle">
        <div class="modal-header">
          <h2 id="editTitle">Editar mensagem</h2>
          <button type="button" class="modal-close" data-close aria-label="Fechar">${iconSvg("x")}</button>
        </div>
        <div class="modal-body">
          <textarea id="editInput" class="field-textarea" rows="4" maxlength="4000"></textarea>
          <p class="modal-hint" id="editHint"></p>
          <p id="editErro" class="modal-error" style="display:none;"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="editSave">Salvar</button>
        </div>
      </div>
    </div>

    <script type="module" src="/js/conversas/main.js"></script>
  `;
  res.send(renderDashboardLayout({
    active: "conversas",
    title: "Conversas",
    content,
    extraHead: `<link rel="stylesheet" href="/css/dashboard-conversas.css" />
  <script>window.CONVERSAS_BOOT = ${inlineJson(await conversationsBoot("Conversas"))};
  window.ATENDIMENTO_COLUMNS = ${inlineJson(ATENDIMENTO_COLUMNS)};</script>`,
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
          <tr><th>Nome</th><th>Telefone</th><th>Etiquetas</th><th>E-mail</th><th>Endereço</th><th>Nascimento</th><th>Atualizado em</th></tr>
        </thead>
        <tbody id="contatosTbody">
          <tr><td colspan="7" class="dash-empty">Carregando contatos...</td></tr>
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
          <button type="button" class="modal-close" data-close aria-label="Fechar">${iconSvg("x")}</button>
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
          <button type="button" class="modal-close" data-close aria-label="Fechar">${iconSvg("x")}</button>
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
