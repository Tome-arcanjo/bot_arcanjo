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

async function postToGraph(to, body, label) {
  const recipient = digits(to);
  if (!recipient) return { ok: false, error: "Conversa sem número de telefone." };

  if (!SEND_ENABLED) {
    if (SIMULATE) {
      console.log(`[WhatsApp][SIMULADO] ${label} para ${recipient}: ${JSON.stringify(body).slice(0, 200)}`);
      return { ok: true, simulated: true, waMessageId: `sim-${uuidv4()}` };
    }
    console.warn(`[WhatsApp] Envio desligado (WHATSAPP_SEND_ENABLED=false) — ${label} para ${recipient} não foi enviado.`);
    return { ok: false, error: "Envio pelo WhatsApp desligado no servidor (WHATSAPP_SEND_ENABLED=false)." };
  }

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn(`[WhatsApp] Tokens não configurados — ${label} para ${recipient} não foi enviado.`);
    return { ok: false, error: "WhatsApp não configurado no servidor (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)." };
  }

  try {
    const response = await fetch(`${GRAPH_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, ...body }),
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
export async function sendWhatsAppMessage(to, text) {
  return postToGraph(to, { type: "text", text: { body: text } }, "mensagem");
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
