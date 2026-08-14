import OpenAI from "openai";
import "dotenv/config";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 1024;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "Voce e um assistente inteligente.";

let client;
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Envia mensagens para a API da OpenAI (GPT)
 * @param {Array} messages - Array de mensagens no formato {role, content}
 * @param {string} [systemPrompt] - System prompt customizado (opcional)
 * @returns {Promise<string>} - Resposta do assistente
 */
export async function sendToOpenAI(messages, systemPrompt) {
  const openai = getClient();
  const systemMessage = { role: "system", content: systemPrompt || SYSTEM_PROMPT };
  const allMessages = [systemMessage, ...messages.filter((m) => m.role !== "system")];

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    messages: allMessages,
  });

  return response.choices[0].message.content;
}

export const openAIConfig = {
  provider: "openai",
  model: DEFAULT_MODEL,
};
