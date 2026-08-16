import { Router } from "express";
import { getDb } from "../database/db.js";
import { listSessions, getSessionMessages } from "../services/chatService.js";

const router = Router();

// GET /api/conversas — lista as conversas (sessões) com uma prévia da
// última mensagem, pra montar a caixa de entrada.
router.get("/", async (req, res) => {
  try {
    const sessions = await listSessions();

    // Busca um lote recente de mensagens de uma vez (em vez de 1 query por
    // sessão) e reduz pra "última mensagem por sessão" em memória.
    const db = getDb();
    const { data: recentMessages, error } = await db
      .from("messages")
      .select("session_id, content, role, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const lastMessageBySession = {};
    for (const m of recentMessages || []) {
      if (!lastMessageBySession[m.session_id]) {
        lastMessageBySession[m.session_id] = m;
      }
    }

    const withPreview = sessions.map((s) => ({
      ...s,
      lastMessage: lastMessageBySession[s.id] || null,
    }));

    res.json({ success: true, data: withPreview });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/conversas/:sessionId/messages — thread completa de uma conversa.
router.get("/:sessionId/messages", async (req, res) => {
  try {
    const messages = await getSessionMessages(req.params.sessionId);
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
