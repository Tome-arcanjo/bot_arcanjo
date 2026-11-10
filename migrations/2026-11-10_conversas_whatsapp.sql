-- ============================================================
-- Conversas no estilo WhatsApp: anexos, respostas, reações, fila de
-- atendimento e etiquetas jurídicas dos clientes (2026-11-10)
--
-- Idempotente: pode rodar quantas vezes quiser. Só ADICIONA colunas e
-- índices — não apaga nenhum dado. O mesmo bloco está no fim do init.sql
-- (que continua sendo a fonte da verdade do schema). Desfazer:
-- migrations/2026-11-10_conversas_whatsapp.rollback.sql
-- ============================================================

-- Tipo da mensagem e o anexo. O arquivo fica no disco do servidor (MEDIA_DIR,
-- ver src/services/mediaService.js); media guarda { path, mime, name, size,
-- sha256, caption, waId }.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
  CHECK (message_type IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'template', 'location', 'contacts', 'unsupported'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media JSONB;
-- Resposta citando outra mensagem (o "context" da Cloud API).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
-- Reações: [{ from: 'client' | 'team', emoji, name, at }] — uma por lado, como no WhatsApp.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT FALSE;
-- A Cloud API não edita nem apaga mensagem já entregue: "editada" quer dizer
-- que saiu uma correção respondendo a ela, e "apagada" vale só para o painel.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_stickers ON messages(created_at DESC) WHERE message_type = 'sticker';

-- Fila de "Atendimento pendente": desde quando o cliente espera uma pessoa
-- (a IA pode estar respondendo). NULL = alguém está atendendo ou encerrado.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS queue_since TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sessions_queue_since ON sessions(queue_since) WHERE queue_since IS NOT NULL;

-- Conversas que já estavam só com a IA entram na fila pela última atividade.
UPDATE sessions SET queue_since = COALESCE(updated_at, created_at, NOW())
WHERE phone IS NOT NULL AND ai_paused = FALSE AND board_stage <> 'Finalizado' AND queue_since IS NULL;

-- Etiquetas jurídicas do cliente (ids de src/constants/tags.js).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_clients_tags ON clients USING GIN (tags);
