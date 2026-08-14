import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { getSettings } from "../services/settingsService.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 1024;

/**
 * Envia mensagens para a API da Anthropic (Claude)
 * @param {Array} messages - Array de mensagens no formato {role, content}
 * @param {string} [systemPrompt] - System prompt customizado (opcional)
 * @returns {Promise<string>} - Resposta do assistente
 */
export async function sendToAnthropic(messages, systemPrompt) {
  const settings = getSettings();
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt || settings.systemPrompt,
    messages: messages.filter((m) => m.role !== "system"),
  });

  return response.content[0].text;
}

export const anthropicConfig = {
  provider: "anthropic",
  model: DEFAULT_MODEL,
};
