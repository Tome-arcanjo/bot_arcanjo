import { getDb } from "../database/db.js";

/**
 * GET /admin
 * Dashboard com histórico de mensagens de todas as sessões
 */
export async function adminDashboard(req, res) {
  try {
    const db = getDb();

    // Busca últimas 100 mensagens com info da sessão
    const { data: messages, error } = await db
      .from("messages")
      .select(`
        id,
        role,
        content,
        created_at,
        sessions (
          id,
          title,
          provider
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    // Estatísticas rápidas
    const { count: totalMessages } = await db
      .from("messages")
      .select("id", { count: "exact", head: true });

    const { count: totalSessions } = await db
      .from("sessions")
      .select("id", { count: "exact", head: true });

    const { count: whatsappSessions } = await db
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .not("phone", "is", null);

    res.send(buildAdminHTML(messages || [], {
      totalMessages: totalMessages || 0,
      totalSessions: totalSessions || 0,
      whatsappSessions: whatsappSessions || 0,
    }));
  } catch (error) {
    console.error("[Admin] Erro ao carregar dashboard:", error.message);
    res.status(500).send(`<pre>Erro: ${error.message}</pre>`);
  }
}

function buildAdminHTML(messages, stats) {
  const rows = messages.map((m) => {
    const session = m.sessions || {};
    const origin = session.phone
      ? `📱 ${session.phone}`
      : `💻 ${session.title || "Web"}`;
    const roleLabel = m.role === "user" ? "👤 Usuário" : "🤖 Bot";
    const roleBadge = m.role === "user"
      ? `<span class="badge user">👤 Usuário</span>`
      : `<span class="badge bot">🤖 Bot</span>`;
    const date = new Date(m.created_at).toLocaleString("pt-BR");
    const preview = (m.content || "").substring(0, 300)
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `
      <tr>
        <td>${date}</td>
        <td>${roleBadge}</td>
        <td class="origin">${origin}</td>
        <td class="msg-preview">${preview}</td>
      </tr>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Bot Arcanjo — Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f0f13; --surface: #16161e; --border: #2a2a3a;
      --accent: #7c6fe0; --text: #e8e8f0; --muted: #8888aa;
      --user: #3b82f6; --bot: #7c6fe0; --success: #4ade80;
    }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    header {
      background: var(--surface); border-bottom: 1px solid var(--border);
      padding: 16px 32px; display: flex; align-items: center; justify-content: space-between;
    }
    header h1 { font-size: 1.1rem; font-weight: 700; }
    header h1 span { color: var(--accent); }
    .refresh-btn {
      background: var(--accent); color: white; border: none; padding: 8px 18px;
      border-radius: 8px; cursor: pointer; font-size: 0.85rem; text-decoration: none;
    }
    .header-actions { display: flex; align-items: center; gap: 10px; }
    .crm-link, .logout-link {
      color: var(--muted); text-decoration: none; font-size: 0.85rem;
      padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border);
    }
    .crm-link:hover, .logout-link:hover { color: var(--text); border-color: var(--accent); }
    .stats { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
    .stat-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
      padding: 20px 28px; flex: 1; min-width: 160px;
    }
    .stat-card .number { font-size: 2rem; font-weight: 700; color: var(--accent); }
    .stat-card .label { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }
    .table-wrapper { padding: 0 32px 32px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th {
      text-align: left; padding: 10px 14px; background: var(--surface);
      border-bottom: 2px solid var(--border); color: var(--muted);
      font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
    }
    td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:hover td { background: rgba(124,111,224,0.04); }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 100px;
      font-size: 0.75rem; font-weight: 600;
    }
    .badge.user { background: rgba(59,130,246,0.15); color: #93c5fd; }
    .badge.bot  { background: rgba(124,111,224,0.15); color: #a78bfa; }
    .origin { color: var(--muted); font-size: 0.82rem; white-space: nowrap; }
    .msg-preview { max-width: 480px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .empty { text-align: center; padding: 60px; color: var(--muted); }
  </style>
  <meta http-equiv="refresh" content="30"/>
</head>
<body>
  <header>
    <h1>⚡ Bot <span>Arcanjo</span> — Admin</h1>
    <div class="header-actions">
      <a href="/crm.html" class="crm-link">CRM</a>
      <a href="/admin" class="refresh-btn">↺ Atualizar</a>
      <a href="/logout" class="logout-link">Sair</a>
    </div>
  </header>

  <div class="stats">
    <div class="stat-card">
      <div class="number">${stats.totalMessages}</div>
      <div class="label">Total de Mensagens</div>
    </div>
    <div class="stat-card">
      <div class="number">${stats.totalSessions}</div>
      <div class="label">Sessões Totais</div>
    </div>
    <div class="stat-card">
      <div class="number">${stats.whatsappSessions}</div>
      <div class="label">Sessões WhatsApp</div>
    </div>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Data/Hora</th>
          <th>Papel</th>
          <th>Origem</th>
          <th>Mensagem</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="4" class="empty">Nenhuma mensagem ainda.</td></tr>`}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
