import { Router } from "express";
import { getDb } from "../database/db.js";
import { listSessions, getSessionMessages } from "../services/chatService.js";
import eventBus from "../utils/events.js";

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

// GET /api/conversas/stream — SSE para atualizações em tempo real
router.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    // Impede que o Nginx (proxy reverso na frente do app — ver server.js)
    // buffeie essa resposta. Sem isso, o SSE pode funcionar perfeitamente
    // em localhost e mesmo assim não chegar em tempo real em produção,
    // porque o Nginx segura os dados no buffer antes de repassar.
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      // O cliente pode ter desconectado no exato instante em que uma
      // mensagem foi emitida. Sem esse try/catch, uma escrita falha aqui
      // sobe como erro não tratado e derruba o processo Node inteiro
      // (webhook do WhatsApp incluso) — não só essa conexão SSE.
      cleanup();
    }
  };

  // Mantém a conexão viva atrás do Nginx (e de qualquer proxy/load balancer
  // com timeout de conexão ociosa, tipicamente ~60s). Sem tráfego nenhum,
  // uma conversa parada pode cair e só reconectar quando o EventSource do
  // navegador notar — o que deixaria uma mensagem chegando durante esse
  // intervalo sem aparecer em tempo real.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (e) {
      cleanup();
    }
  }, 25000);

  function cleanup() {
    clearInterval(heartbeat);
    eventBus.off("newMessage", sendEvent);
  }

  eventBus.on("newMessage", sendEvent);

  req.on("close", cleanup);
  res.on("error", (err) => {
    console.error("[SSE] Conexão de um cliente do painel encerrada com erro:", err.message);
    cleanup();
  });
});

export default router;
