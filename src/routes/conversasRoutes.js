import { Router } from "express";
import { getDb } from "../database/db.js";
import { listSessions, getSessionMessages, getSessionById } from "../services/chatService.js";
import { getWindowState, retryMessage } from "../services/outboundService.js";
import {
  assumeSession,
  releaseSession,
  sendHumanMessage,
  sendTemplateMessage,
  touchPresence,
  leavePresence,
  getViewers,
} from "../services/handoverService.js";
import { SEND_ENABLED, SIMULATE } from "../services/whatsappService.js";
import { openSseStream } from "../utils/sse.js";

const router = Router();

// Erros de regra (HandoverError / outboundService) trazem status e, às vezes,
// um código que o painel trata (HANDLED_BY_OTHER, WINDOW_CLOSED).
function sendError(res, error) {
  const body = { success: false, error: error.message };
  if (error.code) body.code = error.code;
  if (error.handler) body.handler = error.handler;
  if (error.window) body.window = error.window;
  res.status(error.status || 500).json(body);
}

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

// GET /api/conversas/stream — SSE para atualizações em tempo real
// (heartbeat, X-Accel-Buffering e fechamento ao derrubar o usuário: ver utils/sse.js)
//  - mensagem sem nome ("message"): { message, session } — mensagem nova
//  - "status":   { messageId, sessionId, status, error } — entrega pelo WhatsApp
//  - "session":  { session, actor } — IA pausada/retomada, quem está atendendo
//  - "presence": { sessionId, viewers } — quem está com a conversa aberta
router.get("/stream", (req, res) => {
  openSseStream(req, res, [
    { on: "newMessage", event: "message" },
    { on: "messageStatus", event: "status" },
    { on: "sessionUpdated", event: "session" },
    { on: "presence", event: "presence" },
  ]);
});

// POST /api/conversas/messages/:messageId/retry — reenvia uma mensagem que falhou
router.post("/messages/:messageId/retry", async (req, res) => {
  try {
    const { message, ok } = await retryMessage(req.params.messageId);
    res.json({ success: true, data: message, delivered: ok });
  } catch (error) {
    sendError(res, error);
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

// GET /api/conversas/:sessionId/state — quem atende, janela de 24 h, quem está vendo
router.get("/:sessionId/state", async (req, res) => {
  try {
    const session = await getSessionById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: "Conversa não encontrada." });
    res.json({
      success: true,
      data: {
        session,
        window: await getWindowState(session.id),
        viewers: getViewers(session.id),
        sending: SEND_ENABLED ? "on" : SIMULATE ? "simulated" : "off",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/conversas/:sessionId/messages { content, force? } — funcionário responde.
// Pausa a IA automaticamente. 409 HANDLED_BY_OTHER se outra pessoa está
// atendendo (reenviar com force: true para responder mesmo assim) e 409
// WINDOW_CLOSED fora da janela de 24 h.
router.post("/:sessionId/messages", async (req, res) => {
  const { content, force } = req.body || {};
  try {
    const { message, ok } = await sendHumanMessage(req.params.sessionId, req.session.user, content, { force: force === true });
    res.json({ success: true, data: message, delivered: ok });
  } catch (error) {
    sendError(res, error);
  }
});

// POST /api/conversas/:sessionId/template — envia o modelo de retomada (fora das 24 h)
router.post("/:sessionId/template", async (req, res) => {
  try {
    const { message, ok } = await sendTemplateMessage(req.params.sessionId, req.session.user, {
      force: (req.body || {}).force === true,
    });
    res.json({ success: true, data: message, delivered: ok });
  } catch (error) {
    sendError(res, error);
  }
});

// POST /api/conversas/:sessionId/assume { force? } — assume a conversa (pausa a IA)
router.post("/:sessionId/assume", async (req, res) => {
  try {
    const session = await assumeSession(req.params.sessionId, req.session.user, { force: (req.body || {}).force === true });
    res.json({ success: true, data: session });
  } catch (error) {
    sendError(res, error);
  }
});

// POST /api/conversas/:sessionId/release — devolve a conversa à IA
router.post("/:sessionId/release", async (req, res) => {
  try {
    const session = await releaseSession(req.params.sessionId, req.session.user);
    res.json({ success: true, data: session });
  } catch (error) {
    sendError(res, error);
  }
});

// POST /api/conversas/:sessionId/presence { leave? } — "estou com esta conversa aberta"
// (o painel renova a cada 20 s; some sozinho depois de 45 s sem renovar)
router.post("/:sessionId/presence", (req, res) => {
  if ((req.body || {}).leave === true) {
    leavePresence(req.params.sessionId, req.session.user);
    return res.json({ success: true, data: getViewers(req.params.sessionId) });
  }
  res.json({ success: true, data: touchPresence(req.params.sessionId, req.session.user) });
});

export default router;
