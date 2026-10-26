/**
 * Lê um stream SSE (resposta de fetch) e junta os eventos recebidos.
 * Eventos sem "event:" ficam com event = "message" (como no EventSource).
 */
export function sseReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  const waiters = new Set();
  let buffer = "";
  let ended = false;

  const notify = () => waiters.forEach((w) => w());

  function parse(raw) {
    let event = "message";
    const data = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue; // comentário (heartbeat)
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) return null;
    return { event, data: JSON.parse(data.join("\n")) };
  }

  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const ev = parse(buffer.slice(0, i));
          buffer = buffer.slice(i + 2);
          if (ev) {
            events.push(ev);
            notify();
          }
        }
      }
    } catch {
      // conexão cancelada
    }
    ended = true;
    notify();
  })();

  function waitUntil(check, timeoutMs, what) {
    return new Promise((resolve, reject) => {
      const done = () => {
        const result = check();
        if (result) {
          waiters.delete(done);
          clearTimeout(timer);
          resolve(result);
        }
      };
      const timer = setTimeout(() => {
        waiters.delete(done);
        reject(new Error(`SSE: tempo esgotado esperando ${what}`));
      }, timeoutMs);
      waiters.add(done);
      done();
    });
  }

  return {
    events,
    /** Espera um evento que satisfaça `predicate` e o retorna. */
    waitFor: (predicate, timeoutMs = 3000) =>
      waitUntil(() => events.find(predicate), timeoutMs, "um evento"),
    /** Espera o servidor encerrar a conexão. */
    waitEnd: (timeoutMs = 3000) => waitUntil(() => ended, timeoutMs, "o fim da conexão"),
    close: () => reader.cancel().catch(() => {}),
  };
}
