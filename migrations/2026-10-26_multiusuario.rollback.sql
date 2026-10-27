-- ============================================================
-- ROLLBACK de migrations/2026-10-26_multiusuario.sql
--
-- ATENÇÃO: APAGA os usuários, as sessões de login, o histórico dos casos
-- (case_events) e as colunas novas (responsáveis, pausa da IA, status de
-- entrega). Exporte essas tabelas antes se quiser guardar.
--
-- Mensagens escritas por funcionários (role 'human') NÃO são apagadas:
-- viram 'assistant' para caber no CHECK antigo, mantendo o texto.
--
-- Só rode depois de voltar o código para uma versão anterior à Fase 1 —
-- o código novo depende dessas tabelas.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS case_events;

DROP INDEX IF EXISTS idx_crm_cases_phone;
DROP INDEX IF EXISTS idx_crm_cases_assigned_to;
ALTER TABLE crm_cases
  DROP COLUMN IF EXISTS assigned_to,
  DROP COLUMN IF EXISTS assigned_at,
  DROP COLUMN IF EXISTS status_changed_by,
  DROP COLUMN IF EXISTS status_changed_by_name,
  DROP COLUMN IF EXISTS status_changed_at;

UPDATE messages SET role = 'assistant' WHERE role = 'human';
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant', 'system'));

DROP INDEX IF EXISTS idx_messages_session_role_created;
DROP INDEX IF EXISTS idx_messages_wa_message_id;
ALTER TABLE messages
  DROP COLUMN IF EXISTS sender_user_id,
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS delivery_error,
  DROP COLUMN IF EXISTS wa_message_id;

ALTER TABLE sessions
  DROP COLUMN IF EXISTS ai_paused,
  DROP COLUMN IF EXISTS ai_paused_at,
  DROP COLUMN IF EXISTS handler_user_id;

DROP TABLE IF EXISTS web_sessions;
DROP TABLE IF EXISTS users;

COMMIT;
