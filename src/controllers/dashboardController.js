import { getDb } from "../database/db.js";
import { renderDashboardLayout } from "../views/dashboardLayout.js";

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

  res.send(renderDashboardLayout({ active: "configuracoes", title: "Configurações", content }));
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
    res.send(renderDashboardLayout({ active: "canais", title: "Canais", content, topbarActions }));
  } catch (error) {
    console.error("[Canais] Erro ao carregar:", error.message);
    res.status(500).send(`<pre>Erro: ${error.message}</pre>`);
  }
}

// ── CRM (kanban com drag-and-drop) ─────────────────────────────────────
export function crmView(req, res) {
  const content = `
    <div id="crmBoard" class="crm-board">
      <p class="dash-empty">Carregando casos...</p>
    </div>
    <script src="/js/dashboard-crm.js"></script>
  `;
  res.send(renderDashboardLayout({
    active: "crm",
    title: "CRM",
    content,
    extraHead: `<link rel="stylesheet" href="/css/dashboard-crm.css" />`,
  }));
}

// ── Conversas (inbox por cliente) ──────────────────────────────────────
export function conversasView(req, res) {
  const content = `
    <div class="conversas-layout">
      <aside class="conversas-list" id="conversasList">
        <p class="dash-empty">Carregando conversas...</p>
      </aside>
      <section class="conversas-thread" id="conversasThread">
        <p class="dash-empty">Selecione uma conversa à esquerda.</p>
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
  }));
}

// ── Contatos (cadastro de clientes) ────────────────────────────────────
export function contatosView(req, res) {
  const content = `
    <div class="dash-card" style="margin-bottom:16px; padding:14px 18px;">
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
  res.send(renderDashboardLayout({ active: "contatos", title: "Contatos", content }));
}
