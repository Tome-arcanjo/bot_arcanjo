-- ============================================================
-- Quadro de Atendimento e nome do WhatsApp (2026-11-04)
--
-- Idempotente: pode rodar quantas vezes quiser. Só ADICIONA colunas e
-- índices — não apaga nenhum dado. O mesmo bloco está no fim do init.sql
-- (que continua sendo a fonte da verdade do schema). Desfazer:
-- migrations/2026-11-04_quadro_atendimento.rollback.sql
-- ============================================================

-- Nome do perfil do WhatsApp do cliente (contacts[].profile.name do webhook),
-- atualizado a cada mensagem recebida. A Cloud API não fornece a foto.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- Coluna do cliente no quadro de Atendimento (ver src/constants/atendimento.js,
-- que valida os valores — o DEFAULT é a primeira coluna de lá). Só pessoas
-- movem o card; o sistema apenas devolve para a primeira coluna quem escreve
-- de novo depois de "Finalizado".
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS board_stage TEXT NOT NULL DEFAULT 'Aguardando atendimento';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS board_stage_changed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS board_stage_changed_by_name TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS board_stage_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone) WHERE phone IS NOT NULL;
