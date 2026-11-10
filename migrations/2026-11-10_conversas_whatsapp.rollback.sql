-- ============================================================
-- ROLLBACK de migrations/2026-11-10_conversas_whatsapp.sql
--
-- Apaga o tipo/anexo das mensagens (os arquivos em MEDIA_DIR ficam no
-- disco), respostas, reações, a fila de atendimento e as etiquetas dos
-- clientes. Os textos das mensagens ficam.
--
-- Rode este ANTES dos rollbacks mais antigos (quadro de Atendimento e
-- multiusuário). Só rode depois de voltar o código para uma versão anterior.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_clients_tags;
ALTER TABLE clients DROP COLUMN IF EXISTS tags;

DROP INDEX IF EXISTS idx_sessions_queue_since;
ALTER TABLE sessions DROP COLUMN IF EXISTS queue_since;

DROP INDEX IF EXISTS idx_messages_stickers;
ALTER TABLE messages
  DROP COLUMN IF EXISTS message_type,
  DROP COLUMN IF EXISTS media,
  DROP COLUMN IF EXISTS reply_to_id,
  DROP COLUMN IF EXISTS reactions,
  DROP COLUMN IF EXISTS forwarded,
  DROP COLUMN IF EXISTS edited_at,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by_name;

COMMIT;
