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
    /**
     * Cliente manda uma mensagem de texto (ou outro tipo, com `type`).
     * id: wamid fixo (para testar repetição); context: wamid citado.
     */
    text(from, text, { name = "Cliente", type = "text", id, context } = {}) {
      const message = { from, id: id || `wamid.in.${Date.now()}.${n++}`, timestamp: String(Math.floor(Date.now() / 1000)), type };
      if (type === "text") message.text = { body: text };
      if (context) message.context = { from, id: context };
      return post({ contacts: [{ wa_id: from, profile: { name } }], messages: [message] }).then(() => message.id);
    },
    /** Cliente manda um anexo: media = { id, mime_type, caption?, filename? } (id da Graph falsa). */
    media(from, type, media, { name = "Cliente" } = {}) {
      const message = { from, id: `wamid.in.${Date.now()}.${n++}`, timestamp: String(Math.floor(Date.now() / 1000)), type, [type]: media };
      return post({ contacts: [{ wa_id: from, profile: { name } }], messages: [message] }).then(() => message.id);
    },
    /** Cliente reage a uma mensagem (emoji "" tira a reação). */
    reaction(from, waMessageId, emoji, { name = "Cliente" } = {}) {
      const message = { from, id: `wamid.in.${Date.now()}.${n++}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "reaction", reaction: { message_id: waMessageId, emoji } };
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
 * Anexos: POST .../media (upload) devolve { id }; `media` = { [id]: { mime, data } }
 * são os arquivos que os clientes "mandaram" (GET /vXX/<id> e o download).
 */
export async function startFakeGraph({ failFor = {}, media = {} } = {}) {
  const requests = [];
  let n = 0;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const isJson = String(req.headers["content-type"] || "").includes("json");
      const body = isJson && raw.length ? JSON.parse(raw) : raw.length ? { upload: true, size: raw.length, raw: raw.toString("latin1") } : {};
      requests.push({ url: req.url, method: req.method, auth: req.headers.authorization, body });

      const file = req.url.match(/^\/files\/(.+)$/);
      if (file && media[file[1]]) {
        res.setHeader("content-type", media[file[1]].mime);
        return res.end(media[file[1]].data);
      }
      res.setHeader("content-type", "application/json");
      const info = req.method === "GET" && req.url.match(/^\/v[\d.]+\/([^/?]+)$/);
      if (info) {
        const m = media[info[1]];
        if (!m) return (res.statusCode = 404), res.end(JSON.stringify({ error: { code: 100, message: "media not found" } }));
        return res.end(JSON.stringify({ url: `${base}/files/${info[1]}`, mime_type: m.mime, id: info[1] }));
      }
      if (req.url.endsWith("/media")) return res.end(JSON.stringify({ id: `media.out.${++n}` }));
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
    url: base,
    requests,
    /** Envios de mensagem (ignora os "marcar como lida" e os uploads). */
    sends: () => requests.filter((r) => r.body.type),
    /** Uploads de anexo (POST .../media). */
    uploads: () => requests.filter((r) => r.body.upload),
    close: () => new Promise((r) => srv.close(r)),
  };
}
