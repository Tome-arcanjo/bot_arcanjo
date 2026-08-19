# 🤖 Bot Arcanjo

Chatbot inteligente com suporte a múltiplos provedores de IA (OpenAI e Anthropic/Claude), histórico de conversas persistido no Supabase e integração com WhatsApp Business API.

## 📋 Visão Geral

**Bot Arcanjo** é um chatbot moderno e escalável que oferece:

- ✅ **Múltiplos provedores de IA**: OpenAI (GPT) e Anthropic (Claude)
- ✅ **Histórico de conversas**: Persistência no Supabase (PostgreSQL)
- ✅ **Integração WhatsApp**: Recebe e envia mensagens via Meta WhatsApp Business API
- ✅ **Painel administrativo**: Configurações do bot, CRM (Kanban com drag-and-drop), inbox de conversas, lista de contatos e canais — protegido por login
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
│   │   └── crmClassifierService.js  # Classificação de casos + extração de contato via IA
│   ├── providers/
│   │   ├── anthropic.js             # Wrapper Anthropic/Claude
│   │   └── openai.js                # Wrapper OpenAI
│   ├── database/
│   │   └── db.js                    # Cliente Supabase (singleton)
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
├── init.sql                         # Script SQL para criar tabelas
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
| `GET` | `/admin` | Redirecionamento de compatibilidade para `/dashboard/canais` |
| `GET`/`POST` | `/login` | Autenticação |
| `GET` | `/logout` | Encerra a sessão |

### APIs do painel

| Rota | Descrição |
|------|-----------|
| `/api/settings` | Personalidade do bot |
| `/api/crm` | Casos do CRM (listar, mudar status) |
| `/api/contatos` | Lista/busca de clientes |
| `/api/conversas` | Sessões e mensagens |

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

---

## 💬 Fluxo de Mensagem

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
Salva resposta em Supabase
    ↓
Retorna resposta ao cliente
    ↓
whatsappService.js envia via Meta API
```

O painel (`/dashboard/*`) lê os mesmos dados (`sessions`, `messages`, `crm_cases`, `clients`) pelas APIs REST listadas acima. Não há mais interface de chat web de teste — ela foi removida junto com o restante da primeira versão do projeto.

---

## 🛠️ Desenvolvimento

### Scripts Disponíveis

```bash
# Desenvolvimento com hot-reload
npm run dev

# Produção
npm start

# PM2 - Produção (daemon)
pm2 start ecosystem.config.cjs --env production
pm2 logs bot-arcanjo
pm2 restart bot-arcanjo
pm2 stop bot-arcanjo

# Banco de dados
npm run db:migrate
```

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

---

## 🚨 Troubleshooting

### Erro: "Cannot connect to Supabase"
- Verifique `SUPABASE_URL` e `SUPABASE_KEY` no `.env`
- Confirme que a conexão à internet está funcionando
- Verifique se as tabelas foram criadas no Supabase

### Erro: "Invalid API Key"
- Confirme `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` está correto
- Verifique se a chave tem as permissões necessárias

### WhatsApp não recebe respostas
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
