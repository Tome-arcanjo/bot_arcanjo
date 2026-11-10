import express, { Router } from "express";
import { listConversations, getSessionMessages, getSessionById } from "../services/chatService.js";
import { getWindowState, retryMessage } from "../services/outboundService.js";
import {
  assumeSession,
  releaseSession,
  transferSession,
  closeSession,
  sendHumanMessage,
  sendTemplateMessage,
  touchPresence,
  leavePresence,
  getViewers,
} from "../services/handoverService.js";
import {
  reactToMessage,
  editMessage,
  deleteMessage,
  forwardMessage,
  listStickers,
  sendSavedSticker,
} from "../services/messageActionsService.js";
import { prepareUpload, saveMedia, readMedia, isInlineSafe, MAX_UPLOAD_BYTES } from "../services/mediaService.js";
import { SEND_ENABLED, SIMULATE } from "../services/whatsappService.js";
import { moveSessionStage } from "../services/atendimentoService.js";
import { getDb } from "../database/db.js";
import { openSseStream } from "../utils/sse.js";

const router = Router();

// Erros de regra (HandoverError, MessageActionError, MediaError...) trazem
// status e, às vezes, um código que o painel trata (HANDLED_BY_OTHER, WINDOW_CLOSED).
function sendError(res, error) {
  const body = { success: false, error: error.message };
  if (error.code) body.code = error.code;
  if (error.handler) body.handler = error.handler;
  if (error.window) body.window = error.window;
  if (!error.status) console.error("[Conversas]", error.message);
  res.status(error.status || 500).json(body);
}

/** Rota JSON: `fn` devolve o corpo de sucesso (sem o success: true). */
const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req, res)) });
  } catch (error) {
    sendError(res, error);
  }
};

const user = (req) => req.session.user;
const body = (req) => req.body || {};
const force = (req) => body(req).force === true || req.query.force === "true";
const sent = ({ message, ok }) => ({ data: message, delivered: ok });

// GET /api/conversas — conversas com prévia da última mensagem, mensagens sem
// resposta e nome/etiquetas do cadastro (caixa de entrada e quadro de Atendimento).
router.get("/", handle(async () => ({ data: await listConversations() })));

// GET /api/conversas/stream — SSE para atualizações em tempo real
// (heartbeat, X-Accel-Buffering e fechamento ao derrubar o usuário: ver utils/sse.js)
//  - mensagem sem nome ("message"): { message, session } — mensagem nova
//  - "status":   { messageId, sessionId, status, error } — entrega pelo WhatsApp
//  - "update":   { message, sessionId } — reação, edição ou exclusão
//  - "session":  { session, actor } — IA pausada/retomada, transferência, encerramento, coluna do quadro
//  - "client":   { phone, tags, actor } — etiquetas jurídicas do cliente
//  - "presence": { sessionId, viewers } — quem está com a conversa aberta
router.get("/stream", (req, res) => {
  openSseStream(req, res, [
    { on: "newMessage", event: "message" },
    { on: "messageStatus", event: "status" },
    { on: "messageUpdated", event: "update" },
    { on: "sessionUpdated", event: "session" },
    { on: "clientUpdated", event: "client" },
    { on: "presence", event: "presence" },
  ]);
});

// GET /api/conversas/stickers — figurinhas já usadas (para o painel de figurinhas)
router.get("/stickers", handle(async () => ({ data: await listStickers() })));

// GET /api/conversas/media/:messageId — o arquivo do anexo (só com login).
// ?download=1 baixa. Tipos que o navegador executaria (HTML, SVG...) nunca
// abrem inline, e a resposta vai com CSP sandbox.
router.get("/media/:messageId", async (req, res) => {
  try {
    const { data: message } = await getDb().from("messages").select("media").eq("id", req.params.messageId).maybeSingle();
    if (!message?.media) return res.status(404).json({ success: false, error: "Anexo não encontrado." });
    const file = await readMedia(message.media);
    const { mime, name } = message.media;
    const inline = req.query.download !== "1" && isInlineSafe(mime);
    res.set({
      "Content-Type": inline ? mime : "application/octet-stream",
      "Content-Length": file.length,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name || "arquivo")}`,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    });
    res.send(file);
  } catch (error) {
    sendError(res, error);
  }
});

// ── Ações sobre uma mensagem ─────────────────────────────────────────────

// POST /api/conversas/messages/:messageId/retry — reenvia uma mensagem que falhou
router.post("/messages/:messageId/retry", handle(async (req) => sent(await retryMessage(req.params.messageId))));

// POST /api/conversas/messages/:messageId/react { emoji } — "" tira a reação
router.post("/messages/:messageId/react", handle(async (req) => ({
  data: await reactToMessage(req.params.messageId, body(req).emoji, user(req)),
})));

// PATCH /api/conversas/messages/:messageId { content } — editar (envia uma correção ao cliente)
router.patch("/messages/:messageId", handle(async (req) => {
  const { original, correction, delivered } = await editMessage(req.params.messageId, body(req).content, user(req));
  return { data: original, correction, delivered };
}));

// DELETE /api/conversas/messages/:messageId — apagar (só no painel)
router.delete("/messages/:messageId", handle(async (req) => ({ data: await deleteMessage(req.params.messageId, user(req)) })));

// POST /api/conversas/messages/:messageId/forward { sessionIds } — resultado por destino
router.post("/messages/:messageId/forward", handle(async (req) => ({
  data: await forwardMessage(req.params.messageId, body(req).sessionIds, user(req)),
})));

// ── Uma conversa ─────────────────────────────────────────────────────────

// GET /api/conversas/:sessionId/messages — thread completa de uma conversa.
router.get("/:sessionId/messages", handle(async (req) => ({ data: await getSessionMessages(req.params.sessionId) })));

// GET /api/conversas/:sessionId/state — quem atende, janela de 24 h, quem está vendo
router.get("/:sessionId/state", handle(async (req) => {
  const session = await getSessionById(req.params.sessionId);
  if (!session) throw Object.assign(new Error("Conversa não encontrada."), { status: 404 });
  return {
    data: {
      session,
      window: await getWindowState(session.id),
      viewers: getViewers(session.id),
      sending: SEND_ENABLED ? "on" : SIMULATE ? "simulated" : "off",
    },
  };
}));

// POST /api/conversas/:sessionId/messages { content, replyTo?, force? } — funcionário responde.
// Pausa a IA automaticamente. 409 HANDLED_BY_OTHER se outra pessoa está
// atendendo (reenviar com force: true para responder mesmo assim) e 409
// WINDOW_CLOSED fora da janela de 24 h.
router.post("/:sessionId/messages", handle(async (req) =>
  sent(await sendHumanMessage(req.params.sessionId, user(req), body(req).content, { force: force(req), replyToId: body(req).replyTo || null }))
));

// POST /api/conversas/:sessionId/media?mime=&name=&kind=&caption=&replyTo=&force=
// Corpo: o arquivo cru (application/octet-stream). kind: sticker | voice | document.
router.post(
  "/:sessionId/media",
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  handle(async (req) => {
    const { mime, name, kind, caption, replyTo } = req.query;
    const file = await prepareUpload(req.body, { mime, name, kind });
    const media = await saveMedia(file.buffer, { mime: file.mime, name: file.name });
    return sent(
      await sendHumanMessage(req.params.sessionId, user(req), caption || "", {
        type: file.type,
        media,
        force: force(req),
        replyToId: replyTo || null,
      })
    );
  })
);

// POST /api/conversas/:sessionId/sticker { messageId, replyTo?, force? } — figurinha já usada
router.post("/:sessionId/sticker", handle(async (req) =>
  sent(await sendSavedSticker(req.params.sessionId, body(req).messageId, user(req), { force: force(req), replyToId: body(req).replyTo || null }))
));

// POST /api/conversas/:sessionId/template — envia o modelo de retomada (fora das 24 h)
router.post("/:sessionId/template", handle(async (req) => sent(await sendTemplateMessage(req.params.sessionId, user(req), { force: force(req) }))));

// POST /api/conversas/:sessionId/assume { force? } — assume a conversa (pausa a IA)
router.post("/:sessionId/assume", handle(async (req) => ({ data: await assumeSession(req.params.sessionId, user(req), { force: force(req) }) })));

// POST /api/conversas/:sessionId/release — devolve a conversa à IA (volta para a fila)
router.post("/:sessionId/release", handle(async (req) => ({ data: await releaseSession(req.params.sessionId, user(req)) })));

// POST /api/conversas/:sessionId/transfer { userId, force? } — passa para outra pessoa
router.post("/:sessionId/transfer", handle(async (req) => ({
  data: await transferSession(req.params.sessionId, body(req).userId, user(req), { force: force(req) }),
})));

// POST /api/conversas/:sessionId/close { force? } — encerra o atendimento (Finalizado)
router.post("/:sessionId/close", handle(async (req) => ({ data: await closeSession(req.params.sessionId, user(req), { force: force(req) }) })));

// PATCH /api/conversas/:sessionId/stage { stage } — move o cliente no quadro de
// Atendimento (400 coluna inválida, 404 conversa sumiu). Todos veem pelo SSE ("session").
router.patch("/:sessionId/stage", handle(async (req) => ({ data: await moveSessionStage(req.params.sessionId, body(req).stage, user(req)) })));

// POST /api/conversas/:sessionId/presence { leave? } — "estou com esta conversa aberta"
// (o painel renova a cada 20 s; some sozinho depois de 45 s sem renovar)
router.post("/:sessionId/presence", (req, res) => {
  if (body(req).leave === true) {
    leavePresence(req.params.sessionId, user(req));
    return res.json({ success: true, data: getViewers(req.params.sessionId) });
  }
  res.json({ success: true, data: touchPresence(req.params.sessionId, user(req)) });
});

export default router;
