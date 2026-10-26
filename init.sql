
-- ============================================================
-- Bot Arcanjo — Script de inicialização do banco (Supabase)
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- Tabela de sessões de conversa
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT        PRIMARY KEY,
  title       TEXT,
  provider    TEXT        NOT NULL DEFAULT 'openai',
  model       TEXT,
  phone       TEXT,                         -- Número WhatsApp (nulo = conversa web)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca rápida por telefone (WhatsApp)
CREATE INDEX IF NOT EXISTS idx_sessions_phone
  ON sessions(phone)
  WHERE phone IS NOT NULL;

-- Tabela de mensagens
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT        PRIMARY KEY,
  session_id  TEXT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca de mensagens por sessão (ordenadas por data)
CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages(session_id, created_at DESC);

-- ============================================================
-- Migração: adicionar coluna phone se tabela já existia
-- (Rode apenas se a tabela sessions já existe sem a coluna)
-- ============================================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_phone
  ON sessions(phone)
  WHERE phone IS NOT NULL;

-- ============================================================
-- Configurações globais do bot
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  system_prompt TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserir configuração padrão (se não existir)
INSERT INTO bot_settings (id, system_prompt)
VALUES ('global', 'Você é o Arcanjo, um assistente inteligente, prestativo e amigável. Responda sempre em português.')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- CRM Cases
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_cases (
  id          TEXT        PRIMARY KEY,
  phone       TEXT        NOT NULL,
  client_name TEXT,
  status      TEXT        NOT NULL DEFAULT 'Novo caso',
  urgency_tag TEXT        DEFAULT 'Normal',
  area_tag    TEXT,
  summary     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Contatos (cadastro de clientes capturado automaticamente pela IA
-- a partir das conversas de WhatsApp — ver clientsService.js)
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  phone       TEXT        PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  address     TEXT,
  birth_date  DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- ============================================================
-- Ligação com o advogado (agendada pelo painel do CRM — ver callService.js)
--   call_status: NULL (sem ligação) | 'pendente' | 'concluida'
--   call_reminders_sent: quantos avisos de "ligação atrasada" já saíram
--   (a cada 30 min, por até 3 h depois do horário marcado)
-- Rode no SQL Editor do Supabase (ou "npm run db:migrate") se crm_cases já existia.
-- ============================================================
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS call_status TEXT
  CHECK (call_status IS NULL OR call_status IN ('pendente', 'concluida'));
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS call_scheduled_at TIMESTAMPTZ;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS call_completed_at TIMESTAMPTZ;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS call_reminders_sent INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_crm_cases_call_pending
  ON crm_cases(call_scheduled_at)
  WHERE call_status = 'pendente';

-- ============================================================
-- Multiusuário: equipe com login próprio, Kanban compartilhado e
-- atendimento humano nas conversas (2026-10-26)
--
-- Idempotente: pode rodar quantas vezes quiser. Só ADICIONA tabelas,
-- colunas e índices — não apaga nenhum dado. O mesmo bloco está no fim do
-- init.sql (que continua sendo a fonte da verdade do schema). Desfazer:
-- migrations/2026-10-26_multiusuario.rollback.sql
-- ============================================================

-- Funcionários com acesso ao painel. Nunca são apagados (só desativados),
-- para não perder a autoria do histórico.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT        PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'atendente' CHECK (role IN ('admin', 'atendente')),
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- E-mail único sem diferenciar maiúsculas/minúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- Sessões de login do painel (store do express-session). Excluir o usuário
-- apaga as sessões dele junto.
CREATE TABLE IF NOT EXISTS web_sessions (
  sid         TEXT        PRIMARY KEY,
  sess        JSONB       NOT NULL,
  expire      TIMESTAMPTZ NOT NULL,
  user_id     TEXT        REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_expire ON web_sessions(expire);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id) WHERE user_id IS NOT NULL;

-- Atendimento humano: com ai_paused ligado a IA não responde a conversa
-- (as mensagens do cliente continuam sendo salvas e classificadas).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_paused_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS handler_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Mensagens escritas por um funcionário usam o papel 'human'. O CHECK antigo
-- (criado inline, sem nome explícito) é localizado pela definição e trocado.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'messages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%(role%'
  LOOP
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE messages ADD CONSTRAINT messages_role_check
    CHECK (role IN ('user', 'assistant', 'system', 'human'));
END $$;

-- Autor (mensagens 'human') e situação da entrega pelo WhatsApp das
-- mensagens enviadas. NULL = mensagem recebida do cliente ou anterior a isto.
--   pending → sent → delivered → read, ou failed (com delivery_error)
-- wa_message_id liga a mensagem aos avisos de status que a Meta manda depois.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status TEXT
  CHECK (delivery_status IS NULL OR delivery_status IN ('pending', 'sent', 'delivered', 'read', 'failed'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
-- Última mensagem do cliente numa conversa (regra da janela de 24 h da Meta).
CREATE INDEX IF NOT EXISTS idx_messages_session_role_created ON messages(session_id, role, created_at DESC);

-- Responsável pelo caso e última movimentação no Kanban (sempre humanas).
-- status_changed_by_name guarda o nome também para o acesso de emergência,
-- que não tem linha em users.
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS status_changed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS status_changed_by_name TEXT;
ALTER TABLE crm_cases ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crm_cases_assigned_to ON crm_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_cases_phone ON crm_cases(phone);

-- Histórico de cada caso (quem fez o quê e quando). case_id e session_id não
-- têm FK de propósito: o evento 'deleted' precisa continuar existindo depois
-- que o caso some. actor_name guarda o nome mesmo sem user_id (IA, sistema,
-- acesso de emergência).
CREATE TABLE IF NOT EXISTS case_events (
  id          TEXT        PRIMARY KEY,
  case_id     TEXT,
  session_id  TEXT,
  user_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  type        TEXT        NOT NULL CHECK (type IN (
                'created', 'moved', 'assigned', 'deleted', 'tags', 'call', 'ai_paused', 'ai_resumed'
              )),
  from_value  TEXT,
  to_value    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_events_session ON case_events(session_id, created_at DESC) WHERE session_id IS NOT NULL;

-- Defesa extra: as tabelas novas ficam fechadas para as chaves públicas
-- (anon/authenticated). O app usa a service role key, que ignora RLS.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_events ENABLE ROW LEVEL SECURITY;
