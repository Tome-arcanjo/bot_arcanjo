# 🤖 Bot Arcanjo

Chatbot inteligente com suporte a múltiplos provedores de IA (OpenAI e Anthropic/Claude), histórico de conversas persistido no Supabase e integração com WhatsApp Business API.

## 📋 Visão Geral

**Bot Arcanjo** é um chatbot moderno e escalável que oferece:

- ✅ **Múltiplos provedores de IA**: OpenAI (GPT) e Anthropic (Claude)
- ✅ **Histórico de conversas**: Persistência no Supabase (PostgreSQL)
- ✅ **Integração WhatsApp**: Recebe e envia mensagens via Meta WhatsApp Business API
- ✅ **Painel administrativo**: Configurações do bot, CRM (Kanban com drag-and-drop), inbox de conversas, lista de contatos e canais — protegido por login
- ✅ **Equipe com login próprio**: administradores e atendentes, Kanban compartilhado em tempo real (responsável por caso, histórico de quem moveu) e atendimento humano direto pelo painel (assumir a conversa pausa a IA)
- ✅ **Escalável**: Pronto para produção com PM2

**Stack técnico:**
- Node.js (ESM)
- Express.js
- Supabase (PostgreSQL)
- PM2 (gerenciamento de processo)

---

## 📁 Estrutura do Projeto

```
bot_arcanjo/
├── src/
│   ├── server.js                    # Entry point — Express app e rotas
│   ├── controllers/
│   │   ├── whatsappController.js    # Webhook do WhatsApp
│   │   └── dashboardController.js   # Páginas do painel (Configurações, CRM, Conversas, Contatos, Canais)
│   ├── services/
│   │   ├── chatService.js           # Lógica de negócio (sessões, mensagens, IA)
│   │   ├── whatsappService.js       # Envio de mensagens WhatsApp
│   │   ├── clientsService.js        # CRUD da tabela de contatos (clients)
│   │   ├── crmService.js            # Casos do CRM: grava histórico e avisa todos os quadros (tempo real)
│   │   ├── caseEventsService.js     # Histórico dos casos (case_events)
│   │   ├── outboundService.js       # Toda mensagem enviada ao cliente (status de entrega, janela de 24 h)
│   │   ├── handoverService.js       # Atendimento humano: assumir / devolver à IA / presença
│   │   ├── usersService.js          # Funcionários (login, papéis)
│   │   ├── sessionStore.js          # Sessões de login no Supabase
│   │   ├── crmClassifierService.js  # Classificação de casos + extração de contato via IA
│   │   ├── settingsService.js       # Personalidade do bot (bot_settings)
│   │   └── callService.js           # Ligação com o advogado (agendar/remarcar/cancelar + avisos de atraso)
│   ├── providers/
│   │   ├── anthropic.js             # Wrapper Anthropic/Claude
│   │   └── openai.js                # Wrapper OpenAI
│   ├── database/
│   │   ├── db.js                    # Cliente Supabase (singleton)
│   │   └── migrate.js               # npm run db:migrate (roda o init.sql)
│   ├── constants/
│   │   └── crm.js                   # Colunas do Kanban
│   ├── utils/
│   │   ├── events.js                # eventBus (tempo real do painel via SSE)
│   │   ├── sse.js                   # Streams SSE do painel
│   │   └── loginLimiter.js          # Limite de tentativas de login (em memória)
│   ├── views/
│   │   └── dashboardLayout.js       # Layout compartilhado do painel
│   ├── routes/
│   │   ├── auth.js                  # Rotas /login, /logout
│   │   ├── contatosRoutes.js        # Rotas /api/contatos
│   │   ├── conversasRoutes.js       # Rotas /api/conversas
│   │   ├── crmRoutes.js             # Rotas /api/crm
│   │   ├── settingsRoutes.js        # Rotas /api/settings
│   │   └── whatsapp.js              # Rotas /webhook/whatsapp
│   └── middleware/
│       └── auth.js                  # requireAuth — protege o painel
├── public/                          # Frontend estático do painel (CSS/JS/imagens)
├── scripts/
│   ├── gerar-senha.js               # Hash bcrypt para ADMIN_PASSWORD_HASH
│   └── simular-mensagem.js          # Simula um cliente escrevendo no WhatsApp (webhook assinado)
├── test/                            # Testes (npm test) — Supabase falso, sem dependências extras
├── init.sql                         # Script SQL para criar tabelas
├── migrations/                      # Migrações avulsas (colar no Supabase) + rollback
├── ecosystem.config.cjs             # Configuração PM2
├── .env                             # Variáveis de ambiente (não commitar)
├── .env.example                     # Template de .env
├── package.json                     # Dependências do projeto
└── logs/                            # Logs PM2 (auto-criada)
```

---

## 🔌 API REST

### WhatsApp (`/webhook/whatsapp`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/webhook/whatsapp` | Verificação webhook (Meta) |
| `POST` | `/webhook/whatsapp` | Recebe mensagens do WhatsApp |

### Painel administrativo (`/dashboard/*`, exige login)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Redireciona para `/dashboard` |
| `GET` | `/dashboard` | Redireciona para a aba padrão (`/dashboard/conversas`) |
| `GET` | `/dashboard/configuracoes` | Personalidade do bot |
| `GET` | `/dashboard/crm` | CRM (Kanban de casos, drag-and-drop) |
| `GET` | `/dashboard/conversas` | Inbox de conversas por cliente |
| `GET` | `/dashboard/contatos` | Lista de clientes (captura automática via IA) |
| `GET` | `/dashboard/canais` | Tabela de mensagens (antigo `/admin`) |
| `GET` | `/dashboard/usuarios` | Gestão da equipe (somente admin) |
| `GET` | `/admin` | Redirecionamento de compatibilidade para `/dashboard/canais` |
| `GET`/`POST` | `/login` | Autenticação |
| `GET` | `/logout` | Encerra a sessão |

### APIs do painel

| Rota | Descrição |
|------|-----------|
| `/api/me` | Usuário logado; `PUT /api/me/password` troca a própria senha |
| `/api/users` | Gestão de funcionários (somente admin) |
| `/api/settings` | Personalidade do bot (salvar: somente admin) |
| `/api/crm` | Casos do CRM: listar, mover, atribuir responsável, histórico e tempo real (`/api/crm/stream`) |
| `/api/contatos` | Lista/busca de clientes |
| `/api/conversas` | Sessões e mensagens; responder, assumir/devolver à IA, modelo de retomada, reenviar, presença e tempo real |

---

## 📊 Banco de Dados

### Tabela `sessions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT (PK) | UUID da sessão |
| `title` | TEXT | Título da conversa (primeiros 50 chars) |
| `provider` | TEXT | Provedor de IA (`openai` ou `anthropic`) |
| `model` | TEXT | Modelo utilizado |
| `phone` | TEXT | Número WhatsApp (NULL = conversa web) |
| `created_at` | TIMESTAMPTZ | Data de criação |
| `updated_at` | TIMESTAMPTZ | Última atualização |

### Tabela `messages`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT (PK) | UUID da mensagem |
| `session_id` | TEXT (FK) | Referência à sessão (CASCADE) |
| `role` | TEXT | `user`, `assistant` ou `system` |
| `content` | TEXT | Conteúdo da mensagem |
| `created_at` | TIMESTAMPTZ | Data de criação |

**Nota:** O histórico enviado para IA é limitado às últimas **10 mensagens** para otimizar tokens.

### Multiusuário (usuários, sessões de login, responsáveis e histórico)

Adicionado por `migrations/2026-10-26_multiusuario.sql` (o mesmo bloco está no fim do `init.sql`). Tabelas novas: `users`, `web_sessions` e `case_events`. Colunas novas em `sessions` (pausa da IA e responsável), `messages` (papel `human`, autor e status de entrega) e `crm_cases` (responsável e última movimentação). Detalhes no `CLAUDE.md`.

Para aplicar no Supabase, cole o arquivo no SQL Editor ou rode `npm run db:migrate`. O script é idempotente e não apaga dados. O rollback fica em `migrations/2026-10-26_multiusuario.rollback.sql` e **apaga** usuários e histórico.

Para testar o SQL num Postgres local: `PG_TEST_URL=postgres://usuario@127.0.0.1:5432/banco npm test`. Os testes usam um schema temporário e o apagam no fim.

---

## 💬 Fluxo de Mensagem

```
Cliente (WhatsApp)
    ↓
whatsappController.js
    ↓
chatService.saveIncomingMessage()  → salva + classifica (crmClassifierService)
    ↓
IA pausada (um funcionário assumiu)? → sim: para aqui, a equipe responde pelo painel
    ↓ não
chatService.generateAiReply() → anthropic.js | openai.js
    ↓
outboundService.deliverMessage() → whatsappService (Meta) → status da entrega no painel
```

**Atendimento humano:** na aba Conversas, qualquer funcionário pode **Assumir** a conversa (a IA para de responder aquele cliente) e responder pelo painel; **Devolver à IA** volta ao automático. Responder já assume a conversa. Se outra pessoa estiver atendendo, o painel pede confirmação, e mostra quem mais está com a conversa aberta. Toda mensagem enviada mostra se foi entregue; as que falharam aparecem em vermelho, com o motivo e o botão "Tentar de novo". Fora da janela de 24 h da Meta, só é possível enviar o modelo de retomada (`WHATSAPP_TEMPLATE_REENGAGE`).

O painel (`/dashboard/*`) lê os mesmos dados (`sessions`, `messages`, `crm_cases`, `clients`) pelas APIs REST listadas acima. Não há mais interface de chat web de teste — ela foi removida junto com o restante da primeira versão do projeto.

---

## 🛠️ Desenvolvimento

### Scripts Disponíveis

```bash
# Desenvolvimento com hot-reload
npm run dev

# Produção
npm start

# Testes (sobem o servidor de verdade com um Supabase falso em memória;
# os testes de tela usam o Chrome/Edge instalado, em modo headless)
npm test
# opcionais: PG_TEST_URL=... (SQL num Postgres real), CHROME_PATH=..., SCREENSHOT_DIR=...

# PM2 - Produção (daemon)
pm2 start ecosystem.config.cjs --env production
pm2 logs bot-arcanjo
pm2 restart bot-arcanjo
pm2 stop bot-arcanjo

# PM2 - voltar sozinho depois de um reboot da VPS (rodar uma vez)
pm2 startup        # imprime um comando "sudo env PATH=... pm2 startup ..." — copie e rode
pm2 save           # salva a lista de processos atual; rode de novo sempre que mudar

# Banco de dados
npm run db:migrate
```

> O app deve rodar com **uma única instância** (`instances: 1` no `ecosystem.config.cjs`): o tempo real do painel e o limite de tentativas de login ficam na memória do processo.

### Padrões de Código

- **ESM puro**: Use `import`/`export` (projeto configurado com `"type": "module"`)
- **Async/await**: Todo código assíncrono usa `async/await`
- **Tratamento de erros**: Lance `new Error(message)` nos services, capture nos controllers
- **Singleton DB**: Sempre use `getDb()` de `src/database/db.js`
- **Novos provedores IA**: Crie arquivo em `src/providers/`, exporte função `sendToXxx()` e registre em `chatService.js`
- **IDs**: Use `uuid` (`uuidv4()`) para sessões e mensagens
- **Logs**: Use `console.log` com prefixo de contexto: `[AI]`, `[Server Error]`, `[WhatsApp]`

---

## 🌍 Integração WhatsApp

### Setup

1. **Obtenha credenciais Meta:**
   - Acesse [Meta Developers](https://developers.facebook.com/)
   - Crie um app e configure WhatsApp Business API
   - Copie: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`

2. **Configure o `.env`:**
   ```env
   WHATSAPP_TOKEN=EAAxxxxxxx
   WHATSAPP_PHONE_NUMBER_ID=12345678
   WHATSAPP_VERIFY_TOKEN=seu_token_secreto
   ```

3. **Configure webhook em Meta Developers:**
   - **Callback URL:** `https://seu-dominio.com/webhook/whatsapp`
   - **Verify Token:** (mesmo valor do `.env`)
   - **Subscriptions:** `messages`, `message_template_status_update`

4. **Teste o webhook:**
   ```bash
   curl -X GET "http://localhost:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=seu_token_secreto&hub.challenge=test"
   ```

---

## 🚀 Checklist de deploy (equipe multiusuário)

Faça nesta ordem. Até o número de produção da Meta existir, mantenha `WHATSAPP_SEND_ENABLED=false`: nada é enviado de verdade, e as mensagens aparecem no painel como "Não enviada".

1. **Backup** do banco no Supabase (Database → Backups) antes de qualquer mudança.
2. **SQL**: cole `migrations/2026-10-26_multiusuario.sql` no SQL Editor do Supabase (ou rode `npm run db:migrate`). O script é idempotente e não apaga nada. Confira se as tabelas `users`, `web_sessions` e `case_events` apareceram.
3. **`.env` na VPS** (veja o `.env.example`):
   - `SESSION_SECRET` (`openssl rand -hex 32`): obrigatório em produção;
   - `WHATSAPP_APP_SECRET`: sem ele o webhook recusa tudo;
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` (acesso de emergência);
   - `COOKIE_SECURE=auto`, `TRUST_PROXY=1`;
   - `WHATSAPP_SEND_ENABLED=false` e, se quiser treinar a equipe, `WHATSAPP_SIMULATE=true`.
4. **Deploy do código**: `git pull`, depois `npm ci --omit=dev` e `pm2 restart bot-arcanjo --update-env`. Confira `pm2 logs bot-arcanjo`: precisa aparecer `[DB] Conectado ao Supabase` e nenhum erro de `web_sessions`.
5. **Login de emergência**: entre com o `ADMIN_USERNAME` no campo "E-mail". Uma faixa laranja confirma o acesso de emergência.
6. **Criar os usuários**: em **Usuários → + Novo usuário**, cadastre pelo menos um administrador real e os atendentes. Cada pessoa entra com o próprio e-mail e troca a senha em **Minha conta** (clique no nome, no rodapé da barra lateral). Teste o login de cada uma.
7. **Trocar para produção**: `pm2 delete bot-arcanjo`, depois `pm2 start ecosystem.config.cjs --env production` e `pm2 save`. Nos logs deve aparecer `Ambiente : production`.
   - Se aparecer `[Server] Requisição chegou como HTTP em produção`, ajuste o Nginx/Cloudflare (seção abaixo).
   - Quando o aviso sumir, troque para `COOKIE_SECURE=true`.
8. **Conferência rápida**:
   - duas pessoas abrem o CRM: o indicador "Ao vivo" fica verde, e um card movido por uma aparece na hora para a outra;
   - com `WHATSAPP_SIMULATE=true`, rode `node scripts/simular-mensagem.js 5511999999999 "Olá"` na VPS. A conversa aparece em Conversas, com a resposta da IA "Enviada (simulado)".
9. **Rollback**: volte o código para a versão anterior (`git checkout <versão>`) e rode `pm2 restart bot-arcanjo`. As colunas novas não atrapalham a versão antiga. O SQL de rollback (`migrations/2026-10-26_multiusuario.rollback.sql`) só é necessário para limpar o banco, e ele **apaga** usuários e histórico.

## 📱 Checklist de ativação do número de produção da Meta

Quando o número existir, **só mudam variáveis de ambiente**:

1. No WhatsApp Manager: adicione o número à conta do WhatsApp Business, conclua a verificação da empresa e aguarde a aprovação do nome de exibição.
2. Gere um **token permanente** (usuário do sistema no Business Manager, com `whatsapp_business_messaging` e `whatsapp_business_management`) e coloque em `WHATSAPP_TOKEN`.
3. Copie o **ID do número** (não o número em si) para `WHATSAPP_PHONE_NUMBER_ID`.
4. Confira `WHATSAPP_APP_SECRET` (App → Configurações → Básico) e `WHATSAPP_VERIFY_TOKEN`.
5. **Webhook**: URL de callback `https://seu-dominio/webhook/whatsapp`, com o mesmo verify token, e assinatura do campo **`messages`**. Esse campo traz as mensagens recebidas e também os status de entrega (`sent`/`delivered`/`read`/`failed`).
6. **Modelo de retomada**: crie e aprove no WhatsApp Manager um modelo da categoria "Utilidade", em `pt_BR` e sem variáveis (ex: "Olá! Aqui é do escritório Miguel Arcanjo Advocacia. Podemos continuar seu atendimento?"). Coloque o nome em `WHATSAPP_TEMPLATE_REENGAGE`.
7. No `.env`: `WHATSAPP_SEND_ENABLED=true`, `WHATSAPP_SIMULATE=false`. Depois `pm2 restart bot-arcanjo --update-env`.
8. **Teste real**:
   - mande "oi" de um celular: o bot responde, e no painel a resposta passa de "✓ Enviada" para "✓✓ Entregue" e "✓✓ Lida";
   - clique em **Assumir**, responda pelo painel e depois **Devolva à IA**.
9. Se o painel mostrar:
   - "Número não autorizado": o app ainda está em modo de teste;
   - "Token do WhatsApp inválido": gere o token de novo;
   - "Fora da janela de 24 h": o comportamento está correto; use o modelo de retomada.

## 🔒 Produção atrás de Nginx (e Cloudflare)

O app confia em `TRUST_PROXY` saltos de proxy (padrão `1` = o Nginx) para saber se a conexão original era HTTPS. Se o proxy não informar HTTPS, o cookie de login com `COOKIE_SECURE=true` não é gravado e o login entra em loop. Com o padrão `COOKIE_SECURE=auto` o login funciona e o log mostra `[Server] Requisição chegou como HTTP em produção`; nesse caso corrija o proxy:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Sem Cloudflare na frente: $scheme. Com Cloudflare: repasse o que ele mandou.
    proxy_set_header X-Forwarded-Proto $scheme;
    # proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;   # (com Cloudflare)
    proxy_set_header Connection "";
    proxy_buffering off;          # SSE (tempo real do painel)
    proxy_read_timeout 1h;
}
```

**Com Cloudflare:**
- Use SSL/TLS em **Full (strict)**. Em "Flexible" o trecho Cloudflare → VPS é HTTP.
- Para o limite de tentativas de login enxergar o IP real de cada pessoa (e não o do Cloudflare), ative o módulo `real_ip` no Nginx:
  ```nginx
  # lista atual em https://www.cloudflare.com/ips/
  set_real_ip_from 173.245.48.0/20;
  # ... (demais faixas do Cloudflare)
  real_ip_header CF-Connecting-IP;
  ```
  Sem isso, o limite continua funcionando por IP + usuário, mas todos aparecem com o mesmo IP.
- Depois que o log parar de avisar sobre HTTP, troque para `COOKIE_SECURE=true`.

---

## 📝 Variáveis de Ambiente

| Variável | Obrigatório | Padrão | Descrição |
|----------|-----------|--------|-----------|
| `PORT` | ❌ | `3000` | Porta do servidor |
| `NODE_ENV` | ❌ | `development` | `development` ou `production` |
| `AI_PROVIDER` | ✅ | — | `anthropic` ou `openai` |
| `ANTHROPIC_API_KEY` | (se provider) | — | Chave Anthropic |
| `ANTHROPIC_MODEL` | ❌ | `claude-3-5-haiku-20241022` | Modelo Claude |
| `OPENAI_API_KEY` | (se provider) | — | Chave OpenAI |
| `OPENAI_MODEL` | ❌ | `gpt-4o-mini` | Modelo OpenAI |
| `MAX_TOKENS` | ❌ | `1024` | Máximo de tokens na resposta |
| `SYSTEM_PROMPT` | ✅ | — | Instruções do bot |
| `SUPABASE_URL` | ✅ | — | URL Supabase |
| `SUPABASE_KEY` | ✅ | — | Service Role Key Supabase |
| `WHATSAPP_TOKEN` | (opcional) | — | Token WhatsApp |
| `WHATSAPP_PHONE_NUMBER_ID` | (opcional) | — | ID número WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | (opcional) | — | Token verificação webhook |
| `WHATSAPP_APP_SECRET` | ✅ | — | Valida a assinatura do webhook; sem ele o webhook recusa tudo (503) |
| `WHATSAPP_SEND_ENABLED` | ❌ | `false` | `true` envia de verdade. Desligado, as mensagens ficam salvas como "Não enviada" |
| `WHATSAPP_SIMULATE` | ❌ | `false` | Com o envio desligado, finge que enviou (treino/testes) |
| `WHATSAPP_TEMPLATE_REENGAGE` | ❌ | — | Modelo aprovado para retomar conversas após 24 h (`WHATSAPP_TEMPLATE_LANG`, padrão `pt_BR`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | ✅ | `admin` / — | Acesso de emergência ao painel (os funcionários entram com e-mail e senha próprios) |
| `SESSION_SECRET` | ✅ em produção | — | Assina o cookie de login; o servidor não sobe em produção sem ele |
| `COOKIE_SECURE` | ❌ | `auto` | `auto`, `true` ou `false` (ver seção Nginx) |
| `TRUST_PROXY` | ❌ | `1` | Saltos de proxy confiáveis para `X-Forwarded-*` |

---

## 🚨 Troubleshooting

### Erro: "Cannot connect to Supabase"
- Verifique `SUPABASE_URL` e `SUPABASE_KEY` no `.env`
- Confirme que a conexão à internet está funcionando
- Verifique se as tabelas foram criadas no Supabase

### Erro: "Invalid API Key"
- Confirme `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` está correto
- Verifique se a chave tem as permissões necessárias

### Login volta sempre para a tela de login (loop)
- Procure `[Server] Requisição chegou como HTTP em produção` em `logs/out.log`
- Corrija o `X-Forwarded-Proto` no Nginx / o SSL do Cloudflare (seção Nginx acima)
- Enquanto isso, use `COOKIE_SECURE=auto`

### "Muitas tentativas de login"
- Após 5 senhas erradas para o mesmo usuário (ou 20 no mesmo IP) o login fica bloqueado por 15 min
- Reiniciar o processo (`pm2 restart bot-arcanjo`) zera os contadores

### WhatsApp não recebe respostas
- Confirme que `WHATSAPP_APP_SECRET` está configurado (sem ele o webhook responde 503)
- Confirme `WHATSAPP_VERIFY_TOKEN` está correto
- Teste o webhook com GET manual
- Verifique logs em `logs/error.log`

### Hot-reload não funciona
- Use `npm run dev` (não `npm start`)
- Instale `nodemon`: `npm install -D nodemon`

---

## 📚 Documentação Adicional

- [Documentação Anthropic Claude](https://docs.anthropic.com/)
- [Documentação OpenAI](https://platform.openai.com/docs/)
- [Supabase Guide](https://supabase.com/docs)
- [Meta WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)

---

## � Contato

Para suporte e dúvidas técnicas, entre em contato com o desenvolvedor.
