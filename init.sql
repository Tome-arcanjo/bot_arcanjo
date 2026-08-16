
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
