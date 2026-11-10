import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

/**
 * Envio pela WhatsApp Cloud API (Meta).
 *
 * Protegido por flag: só envia de verdade com WHATSAPP_SEND_ENABLED=true.
 * Com a flag desligada:
 *  - WHATSAPP_SIMULATE=true  → finge que enviou (útil para testar o painel
 *    sem número da Meta); o resultado vem com simulated: true;
 *  - senão                   → o envio "falha" com um motivo claro.
 * Quem chama (outboundService) grava o resultado na mensagem, então nada
 * some em silêncio: uma mensagem não enviada aparece no painel com o motivo.
 *
 * As funções de envio NUNCA lançam erro: sempre devolvem
 *   { ok: boolean, waMessageId?: string, error?: string, simulated?: boolean }
 */

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
// v17.0 foi descontinuada pela Meta em 12/09/2025 — mantenha esta versão
// atualizada periodicamente (ver https://developers.facebook.com/docs/graph-api/changelog).
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";
// Só muda nos testes (servidor falso da Graph API).
const GRAPH_URL = process.env.WHATSAPP_GRAPH_URL || "https://graph.facebook.com";
const GRAPH_BASE_URL = `${GRAPH_URL}/${API_VERSION}/${PHONE_NUMBER_ID}`;

export const SEND_ENABLED = process.env.WHATSAPP_SEND_ENABLED === "true";
export const SIMULATE = !SEND_ENABLED && process.env.WHATSAPP_SIMULATE === "true";

// Modelo aprovado pela Meta para retomar a conversa fora da janela de 24 h.
export const REENGAGE_TEMPLATE = process.env.WHATSAPP_TEMPLATE_REENGAGE || "";
export const REENGAGE_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR";

// Erros mais comuns da Cloud API, em português para o painel.
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const META_ERRORS = {
  131047: "Fora da janela de 24 h: o cliente não fala com a gente há mais de 24 h. Envie um modelo aprovado.",
  131026: "O WhatsApp não conseguiu entregar a mensagem (número sem WhatsApp ou app desatualizado).",
  131030: "Número não autorizado: em modo de teste a Meta só entrega para números cadastrados no app.",
  131031: "A conta do WhatsApp Business está bloqueada ou restrita.",
  131051: "Tipo de mensagem não suportado pelo WhatsApp.",
  131056: "Muitas mensagens para este cliente em pouco tempo. Aguarde e tente de novo.",
  132000: "O número de parâmetros não confere com o modelo aprovado.",
  132001: "Modelo de mensagem não encontrado (nome ou idioma errado, ou ainda não aprovado).",
  130429: "Limite de envio da Meta atingido. Tente de novo em instantes.",
  190: "Token do WhatsApp inválido ou expirado (WHATSAPP_TOKEN).",
};

export function describeMetaError(error) {
  if (!error) return "Erro desconhecido da API do WhatsApp.";
  const known = META_ERRORS[error.code];
  const detail = error.error_data?.details || error.message || error.title || "";
  return known || `Erro da API do WhatsApp${error.code ? ` (${error.code})` : ""}: ${detail}`.trim();
}

function digits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Confere as flags antes de falar com a Meta. Devolve null quando pode enviar
 * de verdade; senão, o resultado a usar (simulado ou falha com o motivo).
 */
function sendGate(label, detail, simulated) {
  if (!SEND_ENABLED) {
    if (SIMULATE) {
      console.log(`[WhatsApp][SIMULADO] ${label}: ${detail.slice(0, 200)}`);
      return { ok: true, simulated: true, ...simulated };
    }
    console.warn(`[WhatsApp] Envio desligado (WHATSAPP_SEND_ENABLED=false) — ${label} não foi enviado.`);
    return { ok: false, error: "Envio pelo WhatsApp desligado no servidor (WHATSAPP_SEND_ENABLED=false)." };
  }
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn(`[WhatsApp] Tokens não configurados — ${label} não foi enviado.`);
    return { ok: false, error: "WhatsApp não configurado no servidor (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)." };
  }
  return null;
}

// Ids de mensagens simuladas não existem na Meta: não servem de "context".
const realWaId = (id) => (id && !String(id).startsWith("sim-") ? id : null);

async function postToGraph(to, body, label, { replyTo } = {}) {
  const recipient = digits(to);
  if (!recipient) return { ok: false, error: "Conversa sem número de telefone." };

  const context = realWaId(replyTo);
  const payload = { messaging_product: "whatsapp", recipient_type: "individual", to: recipient, ...body };
  if (context) payload.context = { message_id: context };

  const gated = sendGate(`${label} para ${recipient}`, JSON.stringify(body), { waMessageId: `sim-${uuidv4()}` });
  if (gated) return gated;

  try {
    const response = await fetch(`${GRAPH_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = describeMetaError(data.error);
      console.error(`[WhatsApp Error] ${label} para ${recipient}: ${JSON.stringify(data.error || data)}`);
      return { ok: false, error };
    }
    return { ok: true, waMessageId: data.messages?.[0]?.id || null };
  } catch (error) {
    console.error(`[WhatsApp Error] ${label} para ${recipient}:`, error.message);
    return { ok: false, error: "Falha de conexão com a API do WhatsApp. Tente de novo." };
  }
}

/**
 * Envia uma mensagem de texto livre (só é entregue dentro da janela de 24 h
 * desde a última mensagem do cliente — fora dela a Meta recusa).
 * @param {string} to - telefone com DDI (qualquer formatação; só os dígitos valem)
 * @param {string} text
 */
export async function sendWhatsAppMessage(to, text, { replyTo } = {}) {
  return postToGraph(to, { type: "text", text: { body: text } }, "mensagem", { replyTo });
}

/**
 * Envia um anexo já carregado na Meta (ver uploadWhatsAppMedia).
 * @param {string} to
 * @param {{ type: "image"|"audio"|"video"|"document"|"sticker", mediaId: string, caption?: string, filename?: string }} media
 */
export async function sendWhatsAppMedia(to, { type, mediaId, caption, filename }, { replyTo } = {}) {
  const object = { id: mediaId };
  // Áudio e figurinha não têm legenda; só documento tem nome de arquivo.
  if (caption && (type === "image" || type === "video" || type === "document")) object.caption = caption;
  if (filename && type === "document") object.filename = filename;
  return postToGraph(to, { type, [type]: object }, type, { replyTo });
}

/** Reage (ou tira a reação, com emoji "") a uma mensagem da conversa. */
export async function sendWhatsAppReaction(to, waMessageId, emoji) {
  return postToGraph(to, { type: "reaction", reaction: { message_id: waMessageId, emoji: emoji || "" } }, "reação");
}

/**
 * Carrega um arquivo na Meta para enviar depois por id (vale 30 dias).
 * @returns {Promise<{ ok: boolean, mediaId?: string, error?: string, simulated?: boolean }>}
 */
export async function uploadWhatsAppMedia(buffer, mime, filename) {
  const gated = sendGate("upload de anexo", `${filename} (${mime}, ${buffer.length} bytes)`, { mediaId: `sim-media-${uuidv4()}` });
  if (gated) return gated;
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([buffer], { type: mime }), filename);
    const response = await fetch(`${GRAPH_BASE_URL}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      console.error(`[WhatsApp Error] upload de ${filename}: ${JSON.stringify(data.error || data)}`);
      return { ok: false, error: describeMetaError(data.error) };
    }
    return { ok: true, mediaId: data.id };
  } catch (error) {
    console.error(`[WhatsApp Error] upload de ${filename}:`, error.message);
    return { ok: false, error: "Falha de conexão com a API do WhatsApp ao enviar o anexo." };
  }
}

/**
 * Baixa um anexo recebido (value.messages[i].image.id etc). Só precisa do
 * token — funciona mesmo com o envio desligado.
 * @returns {Promise<{ ok: boolean, buffer?: Buffer, mime?: string, error?: string }>}
 */
export async function downloadWhatsAppMedia(mediaId) {
  if (!WHATSAPP_TOKEN) return { ok: false, error: "Sem WHATSAPP_TOKEN para baixar o anexo." };
  const auth = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
  try {
    const info = await fetch(`${GRAPH_URL}/${API_VERSION}/${mediaId}`, { headers: auth });
    const meta = await info.json().catch(() => ({}));
    if (!info.ok || !meta.url) return { ok: false, error: describeMetaError(meta.error) };
    const file = await fetch(meta.url, { headers: auth });
    if (!file.ok) return { ok: false, error: `A Meta não entregou o arquivo (HTTP ${file.status}).` };
    return { ok: true, buffer: Buffer.from(await file.arrayBuffer()), mime: meta.mime_type || file.headers.get("content-type") };
  } catch (error) {
    console.error(`[WhatsApp Error] download do anexo ${mediaId}:`, error.message);
    return { ok: false, error: "Falha de conexão ao baixar o anexo." };
  }
}

/**
 * Envia um modelo (template) aprovado pela Meta — o único tipo de mensagem
 * permitido fora da janela de 24 h.
 * @param {string} to
 * @param {string} name - nome do modelo aprovado
 * @param {string} [language] - código do idioma (ex: pt_BR)
 * @param {string[]} [bodyParams] - valores para {{1}}, {{2}}... do corpo
 */
export async function sendWhatsAppTemplate(to, name, language = REENGAGE_TEMPLATE_LANG, bodyParams = []) {
  if (!name) return { ok: false, error: "Nenhum modelo de mensagem configurado (WHATSAPP_TEMPLATE_REENGAGE)." };
  const template = { name, language: { code: language } };
  if (bodyParams.length > 0) {
    template.components = [{ type: "body", parameters: bodyParams.map((p) => ({ type: "text", text: String(p) })) }];
  }
  return postToGraph(to, { type: "template", template }, `modelo "${name}"`);
}

/**
 * Marca uma mensagem recebida como lida (mostra o "✓✓" azul para o usuário).
 * Falha silenciosamente — é apenas cosmético e não deve derrubar o fluxo principal.
 * @param {string} messageId - id da mensagem recebida (value.messages[i].id)
 */
export async function markMessageAsRead(messageId) {
  if (!SEND_ENABLED || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !messageId) return;

  try {
    const response = await fetch(`${GRAPH_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn("[WhatsApp] Falha ao marcar como lida:", JSON.stringify(data));
    }
  } catch (error) {
    console.warn("[WhatsApp] Falha ao marcar como lida:", error.message);
  }
}
