import {
  createSession,
  listSessions,
  deleteSession,
  getSessionMessages,
  processMessage,
} from "../services/chatService.js";

// POST /api/chat/sessions - Cria nova sessao
export async function createSessionController(req, res) {
  try {
    const { provider } = req.body;
    const session = await createSession(provider);
    res.status(201).json({ success: true, session });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// GET /api/chat/sessions - Lista sessoes
export async function listSessionsController(req, res) {
  try {
    const sessions = await listSessions();
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// DELETE /api/chat/sessions/:id - Deleta sessao
export async function deleteSessionController(req, res) {
  try {
    const { id } = req.params;
    await deleteSession(id);
    res.json({ success: true, message: "Sessao deletada com sucesso" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// GET /api/chat/sessions/:id/messages - Busca mensagens de uma sessao
export async function getMessagesController(req, res) {
  try {
    const { id } = req.params;
    const messages = await getSessionMessages(id);
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// POST /api/chat/sessions/:id/message - Envia mensagem
export async function sendMessageController(req, res) {
  try {
    const { id } = req.params;
    const { content, provider, systemPrompt } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({ success: false, error: "Mensagem nao pode estar vazia" });
    }

    const response = await processMessage(id, content.trim(), provider, systemPrompt);
    res.json({ success: true, message: response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
