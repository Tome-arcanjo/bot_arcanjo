/**
 * Ajudantes para simular a Meta nos testes:
 *  - webhook(): monta e assina (X-Hub-Signature-256) payloads do webhook;
 *  - startFakeGraph(): servidor falso da Graph API que recebe os envios
 *    (WHATSAPP_GRAPH_URL aponta para ele).
 */
import crypto from "crypto";
import http from "http";
import { freePort } from "./server.js";

export const APP_SECRET = "segredo-do-app-de-teste";

export function webhook(server) {
  async function post(value) {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
    });
    const signature = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex");
    const res = await fetch(`${server.url}/webhook/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body,
    });
    if (res.status !== 200) throw new Error(`webhook respondeu ${res.status}`);
  }

  let n = 0;
  return {
    /** Cliente manda uma mensagem de texto (ou outro tipo, com `type`). */
    text(from, text, { name = "Cliente", type = "text" } = {}) {
      const message = { from, id: `wamid.in.${Date.now()}.${n++}`, timestamp: String(Math.floor(Date.now() / 1000)), type };
      if (type === "text") message.text = { body: text };
      return post({ contacts: [{ wa_id: from, profile: { name } }], messages: [message] });
    },
    /** A Meta avisa o status de uma mensagem que enviamos. */
    status(waMessageId, status, errors) {
      const st = { id: waMessageId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "x" };
      if (errors) st.errors = errors;
      return post({ statuses: [st] });
    },
  };
}

/**
 * Graph API falsa. Responde como a Cloud API: { messages: [{ id }] }.
 * Para o número `failFor` responde com o erro informado (ex: código 131030).
 */
export async function startFakeGraph({ failFor = {} } = {}) {
  const requests = [];
  let n = 0;
  const port = await freePort();
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader("content-type", "application/json");
      const failure = failFor[body.to];
      if (failure) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: failure }));
      }
      res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.out.${++n}` }] }));
    });
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Envios de mensagem (ignora os "marcar como lida"). */
    sends: () => requests.filter((r) => r.body.type),
    close: () => new Promise((r) => srv.close(r)),
  };
}
