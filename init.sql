
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
