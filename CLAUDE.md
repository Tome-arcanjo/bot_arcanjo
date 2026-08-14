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
│   │   ├── chatController.js      # Lida com requisições REST do chat web
│   │   ├── whatsappController.js  # Webhook do WhatsApp (verificação + mensagens)
│   │   └── adminController.js     # Dashboard admin (HTML gerado no servidor)
│   ├── services/
│   │   ├── chatService.js         # Lógica de negócio: sessões, mensagens, chamada de IA
│   │   └── whatsappService.js     # Envio de mensagens de volta ao WhatsApp
│   ├── providers/
│   │   ├── anthropic.js           # Wrapper para Anthropic SDK (Claude)
│   │   └── openai.js              # Wrapper para OpenAI SDK
│   ├── database/
│   │   └── db.js                  # Inicialização e singleton do cliente Supabase
│   ├── routes/
│   │   ├── chat.js                # Rotas REST: /api/chat/*
│   │   └── whatsapp.js            # Rotas: GET/POST /webhook/whatsapp
│   └── middleware/                # (pasta reservada para middlewares futuros)
├── public/                        # Frontend estático (HTML/CSS/JS)
├── data/                          # Dados locais (se houver)
├── logs/                          # Logs do PM2 (out.log, error.log)
├── init.sql                       # Script SQL para criar tabelas no Supabase
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

---

## Rotas da API

### Chat Web (`/api/chat`)
- `POST /api/chat/session` — Cria nova sessão de conversa
- `GET  /api/chat/sessions` — Lista todas as sessões
- `DELETE /api/chat/session/:id` — Deleta uma sessão
- `GET  /api/chat/session/:id/messages` — Busca mensagens de uma sessão
- `POST /api/chat/message` — Envia mensagem e recebe resposta da IA

### WhatsApp (`/webhook/whatsapp`)
- `GET  /webhook/whatsapp` — Verificação do webhook pela Meta
- `POST /webhook/whatsapp` — Recebe mensagens de usuários do WhatsApp

### Admin / Frontend
- `GET /admin` — Dashboard administrativo (HTML server-side)
- `GET /` — Interface web (serve `public/index.html`)

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

> **Importante**: O histórico enviado para a IA é limitado às últimas **10 mensagens** da sessão para controlar o uso de tokens.

---

## Fluxo Principal de Mensagem

```
Cliente (web ou WhatsApp)
  ↓
Controller (chatController / whatsappController)
  ↓
chatService.processMessage()
  ↓
callAIProvider() → anthropic.js | openai.js
  ↓
Salva resposta no Supabase
  ↓
Retorna resposta ao cliente
```

Para WhatsApp: após receber a resposta, `whatsappService.js` envia a mensagem de volta via API da Meta.

---

## Comandos Úteis

```bash
# Desenvolvimento (com hot-reload)
npm run dev

# Produção
npm start

# Produção com PM2
pm2 start ecosystem.config.cjs --env production
pm2 logs bot-arcanjo
pm2 restart bot-arcanjo

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
- A pasta `logs/` é criada automaticamente pelo PM2; não precisa ser commitada.
- O frontend estático fica em `public/` — qualquer arquivo lá é servido diretamente pelo Express.
- Supabase é o único banco — não há SQLite ou banco local.
- O bot responde em **português** por padrão (definido no `SYSTEM_PROMPT`).
