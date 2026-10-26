import eventBus from "./events.js";

/**
 * Abre um stream SSE (Server-Sent Events) que repassa eventos do eventBus
 * para o navegador. Usado pelos tempos reais do painel (/api/conversas/stream
 * e /api/crm/stream).
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {Array<{ on: string, event?: string, map?: (payload) => any }>} subscriptions
 *   on    = nome do evento no eventBus
 *   event = nome do evento SSE ("message" = sem nome, cai no onmessage do EventSource)
 *   map   = transforma/filtra o payload (retornar undefined não envia nada)
 */
export function openSseStream(req, res, subscriptions) {
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

  let closed = false;

  function safeWrite(chunk) {
    try {
      res.write(chunk);
    } catch (e) {
      // O cliente pode ter desconectado no exato instante em que um evento
      // foi emitido. Sem esse try/catch, uma escrita falha aqui sobe como
      // erro não tratado e derruba o processo Node inteiro (webhook do
      // WhatsApp incluso) — não só essa conexão SSE.
      cleanup();
    }
  }

  const listeners = subscriptions.map(({ on, event = "message", map }) => {
    const listener = (payload) => {
      if (closed) return;
      const data = map ? map(payload) : payload;
      if (data === undefined) return;
      const head = event === "message" ? "" : `event: ${event}\n`;
      safeWrite(`${head}data: ${JSON.stringify(data)}\n\n`);
    };
    eventBus.on(on, listener);
    return { on, listener };
  });

  // Mantém a conexão viva atrás do Nginx (e de qualquer proxy/load balancer
  // com timeout de conexão ociosa, tipicamente ~60s). Sem tráfego nenhum,
  // a conexão pode cair e só reconectar quando o EventSource do navegador
  // notar — o que deixaria um evento desse intervalo sem aparecer.
  const heartbeat = setInterval(() => safeWrite(": ping\n\n"), 25000);

  // Usuário desativado / com papel ou senha trocados: as sessões dele já
  // foram apagadas, mas esta conexão aberta continuaria recebendo eventos.
  const userId = req.session?.user?.id;
  const onUserRevoked = ({ userId: revokedId }) => {
    if (userId && revokedId === userId) {
      cleanup();
      res.end();
    }
  };
  eventBus.on("userRevoked", onUserRevoked);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const { on, listener } of listeners) eventBus.off(on, listener);
    eventBus.off("userRevoked", onUserRevoked);
  }

  req.on("close", cleanup);
  res.on("error", (err) => {
    console.error("[SSE] Conexão de um cliente do painel encerrada com erro:", err.message);
    cleanup();
  });

  // Abre o stream imediatamente (alguns proxies só repassam depois do 1º byte)
  // e pede ao navegador para reconectar em 3s se cair.
  safeWrite("retry: 3000\n: conectado\n\n");
}
