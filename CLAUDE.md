# Bot Arcanjo — Contexto do Projeto

## Visão Geral

Chatbot com suporte a **múltiplos provedores de IA** (OpenAI e Anthropic/Claude), histórico de conversas persistido no Supabase e interface web. Também recebe mensagens via **WhatsApp Business API** (Meta).

- **Runtime**: Node.js (ESM — `"type": "module"`)
- **Framework**: Express.js
- **Banco de dados**: Supabase (PostgreSQL via `@supabase/supabase-js`)
- **Processo em produção**: PM2 (`ecosystem.config.cjs`)
- **Deploy**: VPS/Hostinger

---

## Estrutura de Diretórios

```
bot_arcanjo/
├── src/
│   ├── server.js                  # Entry point — Express app, rotas, boot
│   ├── controllers/
│   │   ├── whatsappController.js  # Webhook do WhatsApp (verificação + mensagens)
│   │   └── dashboardController.js # Páginas do painel (Configurações, CRM, Conversas, Contatos, Canais)
│   ├── services/
│   │   ├── chatService.js         # Lógica de negócio: sessões, mensagens, chamada de IA
│   │   ├── whatsappService.js     # Envio de mensagens de volta ao WhatsApp
│   │   ├── clientsService.js      # CRUD da tabela de contatos (clients)
│   │   ├── crmService.js          # Acesso a dados de crm_cases (usado pelas rotas, pela IA e pelas ligações)
│   │   ├── crmClassifierService.js # Classificação de casos + extração de contato via IA
│   │   ├── settingsService.js     # Personalidade do bot (bot_settings, com cache em memória)
│   │   ├── usersService.js        # Funcionários (users): login, CRUD, regras de papel, derrubar sessões
│   │   ├── sessionStore.js        # Store do express-session no Supabase (web_sessions) + cache em memória
│   │   └── callService.js         # Ligação com o advogado: agendar/remarcar/cancelar/concluir + avisos de atraso
│   ├── providers/
│   │   ├── anthropic.js           # Wrapper para Anthropic SDK (Claude)
│   │   └── openai.js              # Wrapper para OpenAI SDK
│   ├── database/
│   │   ├── db.js                  # Inicialização e singleton do cliente Supabase
│   │   └── migrate.js             # npm run db:migrate (roda o init.sql via DATABASE_URL)
│   ├── utils/
│   │   ├── events.js              # eventBus (EventEmitter global) que alimenta os SSE do painel
│   │   └── loginLimiter.js        # Limite de tentativas de login por IP+usuário e por IP (em memória)
│   ├── views/
│   │   └── dashboardLayout.js     # Layout compartilhado do painel (sidebar, topbar, tema)
│   ├── routes/
│   │   ├── auth.js                # Rotas: /login, /logout
│   │   ├── contatosRoutes.js      # Rotas: /api/contatos
│   │   ├── conversasRoutes.js     # Rotas: /api/conversas
│   │   ├── crmRoutes.js           # Rotas: /api/crm
│   │   ├── settingsRoutes.js      # Rotas: /api/settings (personalidade do bot)
│   │   ├── usersRoutes.js         # Rotas: /api/users (admin) e /api/me
│   │   └── whatsapp.js            # Rotas: GET/POST /webhook/whatsapp
│   └── middleware/
│       └── auth.js                # requireAuth (usuário em req.session.user) e requireAdmin
├── public/                        # Frontend estático (CSS/JS/imagens do painel)
├── test/                          # npm test — node:test + Supabase falso (test/fakes) via loader (test/support)
├── data/                          # Dados locais (se houver)
├── logs/                          # Logs do PM2 (out.log, error.log)
├── init.sql                       # Script SQL para criar tabelas no Supabase (fonte da verdade, idempotente)
├── migrations/                    # Blocos avulsos para colar no Supabase + rollback de cada um
├── ecosystem.config.cjs           # Configuração PM2 para produção
├── .env                           # Variáveis de ambiente (NÃO commitar)
├── .env.example                   # Template de variáveis de ambiente
└── package.json
```

---

## Variáveis de Ambiente (`.env`)

| Variável | Descrição | Exemplo |
|---|---|---|
| `PORT` | Porta do servidor | `3000` |
| `NODE_ENV` | Ambiente | `development` / `production` |
| `AI_PROVIDER` | Provedor padrão de IA | `anthropic` / `openai` |
| `OPENAI_API_KEY` | Chave da API OpenAI | `sk-...` |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic | `sk-ant-...` |
| `OPENAI_MODEL` | Modelo OpenAI | `gpt-4o-mini` |
| `ANTHROPIC_MODEL` | Modelo Anthropic | `claude-3-5-haiku-20241022` |
| `MAX_TOKENS` | Máximo de tokens na resposta | `1024` |
| `SYSTEM_PROMPT` | Prompt de sistema do bot | `Voce e o Arcanjo...` |
| `SUPABASE_URL` | URL do projeto Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_KEY` | Service Role Key do Supabase | `eyJ...` |
| `WHATSAPP_TOKEN` | Token da API WhatsApp (Meta) | `EAAxxxxxxx` |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número WhatsApp | `12345678` |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificação do webhook | `meu_token_secreto` |
| `WHATSAPP_APP_SECRET` | OBRIGATÓRIO: valida a assinatura `X-Hub-Signature-256`. Sem ele o webhook responde 503 a tudo | `abc123...` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | Acesso de emergência ao painel (admin fora do banco; hash bcrypt de `scripts/gerar-senha.js`) | `admin` / `$2a$12$...` |
| `SESSION_SECRET` | Assina o cookie de login. OBRIGATÓRIO em produção (o servidor não sobe sem ele) | `openssl rand -hex 32` |
| `COOKIE_SECURE` | `auto` (padrão: Secure só se o proxy informar HTTPS), `true` ou `false` | `auto` |
| `TRUST_PROXY` | Saltos de proxy confiáveis para `X-Forwarded-*` (padrão `1` = Nginx) | `1` |
| `CALL_ALERT_PHONES` | OPCIONAL: números (DDI, só dígitos, vírgula) que também recebem o aviso de "ligação atrasada" no WhatsApp. Vazio = só aviso no navegador | `5511999999999,5511888888888` |
| `APP_TIMEZONE` | Fuso dos horários nas mensagens de ligação (padrão `America/Sao_Paulo`) | `America/Sao_Paulo` |

---

## Rotas da API

### WhatsApp (`/webhook/whatsapp`)
- `GET  /webhook/whatsapp` — Verificação do webhook pela Meta
- `POST /webhook/whatsapp` — Recebe mensagens de usuários do WhatsApp

### Painel administrativo (`/dashboard/*`, exige login)
- `GET /` — Redireciona para `/dashboard`
- `GET /dashboard` — Redireciona para a aba padrão (`/dashboard/conversas`)
- `GET /dashboard/configuracoes` — Personalidade do bot
- `GET /dashboard/crm` — CRM (Kanban de casos, com drag-and-drop)
- `GET /dashboard/conversas` — Inbox de conversas por cliente
- `GET /dashboard/contatos` — Lista de clientes (dados capturados automaticamente pela IA)
- `GET /dashboard/canais` — Tabela de mensagens/canais (antigo `/admin`)
- `GET /admin` — Mantido só como redirecionamento de compatibilidade para `/dashboard/canais`
- `GET /login`, `POST /login`, `GET /logout` — Autenticação (ver `src/routes/auth.js`)

### Login, usuários e papéis
- Cada funcionário entra com **e-mail + senha** (tabela `users`, bcrypt). `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` do `.env` são o **acesso de emergência**: um admin virtual (`id: null`, `emergency: true`, nome "Admin (emergência)"), que não depende da tabela `users`.
- `req.session.user = { id, name, email, role }`. As sessões ficam em `web_sessions` (`sessionStore.js`) e sobrevivem a `pm2 restart`.
- **Papéis**: `admin` gerencia usuários (`/api/users`), exclui casos (`DELETE /api/crm/cases/:id`) e edita a personalidade do bot (`POST /api/settings`, `/dashboard/configuracoes`). `atendente` faz todo o resto. Use `requireAdmin` (de `middleware/auth.js`) em toda rota nova que seja só de admin.
- **Derrubar acesso**: desativar, trocar o papel ou redefinir a senha apaga as sessões da pessoa (`sessionStore.destroyByUser`) e emite `userRevoked` no `eventBus`. **Todo SSE novo precisa escutar `userRevoked` e fechar a conexão do usuário.** Trocar a própria senha mantém só a sessão atual. Renomear atualiza as sessões abertas sem derrubar.
- **Regras**: e-mail único (minúsculo); senha de 8 a 72 bytes; ninguém se rebaixa nem se desativa; sempre sobra um admin ativo; só se exclui definitivamente quem não tem histórico (senão, desativar).
- Os sids encerrados ficam bloqueados por 30 min no store, para que uma requisição que estava em andamento (ex: SSE) não "ressuscite" a sessão ao terminar.

### APIs do painel
- `GET /api/me` — usuário logado. `PUT /api/me/password` `{ currentPassword, newPassword }` — troca a própria senha (com o mesmo limite de tentativas do login)
- `/api/users` (admin) — `GET` lista, `POST` cria `{ name, email, password, role }`, `PATCH /:id` `{ name?, email?, role?, active? }`, `POST /:id/password` `{ password }`, `DELETE /:id` (só sem histórico)
- `/api/settings` — Personalidade do bot (usado pela aba Configurações; salvar é só admin)
- `/api/crm` — Casos do CRM (listar, mudar status, etiquetas, criar/excluir)
  - `PUT /api/crm/cases/:id/call` `{ scheduledAt }` — agenda a ligação; se já houver uma pendente, remarca e o bot avisa o cliente
  - `POST /api/crm/cases/:id/call/complete` — marca a ligação como concluída
  - `GET /api/crm/calls/overdue` — ligações pendentes atrasadas (janela de 3 h) com o intervalo de aviso atual; alimenta os alertas do navegador
  - `DELETE /api/crm/cases/:id/call` — cancela a ligação e o bot avisa o cliente
- `/api/contatos` — Lista/busca de clientes
- `/api/conversas` — Sessões e mensagens (usado pela aba Conversas)

---

## Banco de Dados (Supabase)

Schema definido em `init.sql`. Duas tabelas principais:

### `sessions`
| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | TEXT PK | UUID da sessão |
| `title` | TEXT | Título (primeiros 50 chars da 1ª msg) |
| `provider` | TEXT | `openai` ou `anthropic` |
| `model` | TEXT | Modelo de IA usado |
| `phone` | TEXT | Número WhatsApp (NULL = conversa web) |
| `created_at` | TIMESTAMPTZ | — |
| `updated_at` | TIMESTAMPTZ | — |

### `messages`
| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | TEXT PK | UUID da mensagem |
| `session_id` | TEXT FK | Referência à sessão (CASCADE delete) |
| `role` | TEXT | `user`, `assistant` ou `system` |
| `content` | TEXT | Conteúdo da mensagem |
| `created_at` | TIMESTAMPTZ | — |

### Ligação com o advogado (`crm_cases.call_*`)
O admin agenda a ligação pelo card do caso no CRM (a IA nunca agenda). Colunas: `call_status` (`NULL` | `pendente` | `concluida` — etiquetas "Ligação Pendente" / "Ligação Concluída"), `call_scheduled_at`, `call_completed_at`, `call_reminders_sent`.

- **Remarcar/cancelar**: o bot envia uma mensagem ao cliente pelo WhatsApp e a registra na conversa.
- **Atraso (aviso principal, no navegador)**: `public/js/dashboard-call-alerts.js` é carregado em todas as telas do painel (via `dashboardLayout.js`), consulta `/api/crm/calls/overdue` a cada 30 s e dispara notificação do sistema + som + faixa na tela quando a ligação passa do horário, repetindo a cada 30 min por 3 h (7 avisos). O último aviso dado fica no `localStorage`, então recarregar/navegar não repete. Para não virar spam (e não ser bloqueado por extensões como o Malwarebytes Browser Guard): várias ligações viram UMA notificação-resumo, com `tag` fixa (a nova substitui a anterior), sem `requireInteraction`, com 60 s de intervalo mínimo entre notificações, no máximo 3 faixas na tela e nunca duas consultas simultâneas. O admin precisa clicar em "🔔 Ativar alertas" uma vez para liberar as notificações, e alguma aba do painel precisa estar aberta. No CRM o card também fica vermelho ("atrasada") e há um banner no topo.
- **Atraso (opcional, WhatsApp)**: se `CALL_ALERT_PHONES` estiver preenchido, `callService.startCallReminderScheduler()` (boot, a cada 1 min) também manda o mesmo cronograma de avisos por WhatsApp. Concluir, cancelar ou remarcar encerra/zera os avisos.
- Limitação da Meta: texto livre só é entregue a quem falou com o bot nas últimas 24 h; fora disso o envio falha (vale para o aviso ao cliente e para `CALL_ALERT_PHONES`; o painel avisa o admin quando o cliente não pôde ser notificado).
- As colunas vêm de `init.sql` — rode `npm run db:migrate` (ou o SQL no Supabase) ao atualizar.

### Multiusuário (`migrations/2026-10-26_multiusuario.sql`, também no fim do `init.sql`)
- `users`: `id`, `name`, `email` (único sem diferenciar maiúsculas, índice em `lower(email)`), `password_hash` (bcrypt), `role` (`admin` | `atendente`), `active`. Usuários não são apagados, só desativados (preserva autoria).
- `web_sessions`: store das sessões de login (`sid`, `sess` JSONB, `expire`, `user_id` com `ON DELETE CASCADE`).
- `sessions` ganha `ai_paused`, `ai_paused_at`, `handler_user_id` (quem está atendendo a conversa).
- `messages`: `role` aceita `human` (mensagem escrita por funcionário), mais `sender_user_id`, `delivery_status` (`pending` | `sent` | `delivered` | `read` | `failed`, NULL para mensagens recebidas/antigas), `delivery_error` e `wa_message_id` (liga aos status que a Meta envia depois pelo webhook).
- `crm_cases` ganha `assigned_to`, `assigned_at`, `status_changed_by`, `status_changed_by_name`, `status_changed_at`.
- `case_events`: histórico (`case_id` e `session_id` **sem FK** de propósito, para o evento `deleted` sobreviver; `user_id` + `actor_name`; `type` em `created` | `moved` | `assigned` | `deleted` | `tags` | `call` | `ai_paused` | `ai_resumed`; `from_value`/`to_value`).
- RLS ligado (sem policies) em `users`, `web_sessions` e `case_events`: só a service role key acessa. Se aparecer erro de "row-level security", o `SUPABASE_KEY` não é a service role.
- Rollback: `migrations/2026-10-26_multiusuario.rollback.sql` (apaga as tabelas/colunas novas; mensagens `human` viram `assistant`).
- FKs para `users` usam `ON DELETE SET NULL`; o `actor_name` em `case_events` mantém o nome.
- SQL novo deve ser testado num Postgres real: `PG_TEST_URL=postgres://... npm test` (sem a variável, `test/fase1-sql.test.js` é pulado).

> **Importante**: O histórico enviado para a IA é limitado às últimas **10 mensagens** da sessão para controlar o uso de tokens.

---

## Fluxo Principal de Mensagem

```
Cliente (WhatsApp)
  ↓
whatsappController.js
  ↓
chatService.processMessage()
  ↓
callAIProvider() → anthropic.js | openai.js
  ↓
crmClassifierService (fire-and-forget: classifica caso + extrai contato)
  ↓
Salva resposta no Supabase
  ↓
Retorna resposta ao cliente
```

Após receber a resposta, `whatsappService.js` envia a mensagem de volta via API da Meta. O painel (`/dashboard/*`) lê os mesmos dados (`sessions`, `messages`, `crm_cases`, `clients`) via as APIs REST listadas acima — não há mais interface de chat web de teste (removida junto com o restante da primeira versão do projeto).

---

## Comandos Úteis

```bash
# Desenvolvimento (com hot-reload)
npm run dev

# Produção
npm start

# Testes (sobem src/server.js num processo filho com Supabase falso)
npm test

# Produção com PM2
pm2 start ecosystem.config.cjs --env production
pm2 logs bot-arcanjo
pm2 restart bot-arcanjo

# PM2 sobrevivendo a reboot da VPS (uma vez; "pm2 save" de novo a cada mudança na lista de processos)
pm2 startup   # copie e rode o comando sudo que ele imprimir
pm2 save

# Banco de dados
npm run db:migrate
```

---

## Convenções e Padrões

- **ESM puro**: Usar `import`/`export` (não `require`). O projeto tem `"type": "module"` no `package.json`.
- **Async/await**: Todo código assíncrono usa `async/await` (sem callbacks ou `.then()` encadeados).
- **Erros**: Lançar `new Error(message)` nos services; capturar nos controllers e retornar JSON `{ success: false, error: "..." }`.
- **Singleton do DB**: Sempre importar `getDb()` de `src/database/db.js` — nunca instanciar o Supabase diretamente.
- **Provedores de IA**: Adicionar novos provedores em `src/providers/`, exportar função `sendToXxx(messages, systemPrompt)` e registrar em `chatService.js` no switch `callAIProvider`.
- **IDs**: Usar `uuid` (`uuidv4()`) para gerar IDs de sessões e mensagens.
- **Logs**: Usar `console.log` prefixado com contexto, ex: `[AI]`, `[Server Error]`, `[WhatsApp]`.

---

## Notas para o Claude Code

- O arquivo `.env` **não está no git** — nunca sugerir commitar segredos.
- O `ecosystem.config.cjs` usa extensão `.cjs` propositalmente (PM2 não suporta ESM nativo no arquivo de configuração).
- **Uma instância só** (`instances: 1`, fork): o `eventBus`/SSE e o limitador de login vivem na memória do processo.
- **Segurança de base**: o webhook recusa (503) sem `WHATSAPP_APP_SECRET`; produção não sobe sem `SESSION_SECRET`; login limitado a 5 erros por IP+usuário e 20 por IP a cada 15 min; o id da sessão é regenerado no login. Não há `cors()` (o painel é same-origin).
- **Proxy**: atrás de Nginx (e Cloudflare), o `X-Forwarded-Proto` decide se o cookie é `Secure`. O log `[Server] Requisição chegou como HTTP em produção` indica proxy mal configurado (ver README, seção Nginx).
- **Testes**: `test/support/loader.mjs` troca `@supabase/supabase-js` por `test/fakes/supabase.js` (banco em um JSON temporário). O fake não valida colunas/CHECKs — SQL novo precisa ser conferido num Postgres de verdade.
- A pasta `logs/` é criada automaticamente pelo PM2; não precisa ser commitada.
- O frontend estático fica em `public/` — qualquer arquivo lá é servido diretamente pelo Express.
- Supabase é o único banco — não há SQLite ou banco local.
- O bot responde em **português** por padrão (definido no `SYSTEM_PROMPT`).
