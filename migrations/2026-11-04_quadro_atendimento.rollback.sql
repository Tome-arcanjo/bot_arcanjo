-- ============================================================
-- ROLLBACK de migrations/2026-11-04_quadro_atendimento.sql
--
-- Apaga o nome do WhatsApp guardado nas conversas e a posição de cada
-- cliente no quadro de Atendimento. Mensagens, casos e usuários ficam.
--
-- Rode ANTES o rollback de 2026-11-10_conversas_whatsapp (se aplicada).
-- Só rode depois de voltar o código para uma versão anterior a esta.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_sessions_phone;
ALTER TABLE sessions
  DROP COLUMN IF EXISTS contact_name,
  DROP COLUMN IF EXISTS board_stage,
  DROP COLUMN IF EXISTS board_stage_changed_by,
  DROP COLUMN IF EXISTS board_stage_changed_by_name,
  DROP COLUMN IF EXISTS board_stage_changed_at;

COMMIT;
