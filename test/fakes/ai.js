/**
 * Provedores de IA falsos (substituem src/providers/anthropic.js e openai.js
 * via test/support/loader.mjs). Cada chamada é anotada em FAKE_AI_LOG (uma
 * linha JSON por chamada) para os testes conferirem o que a IA recebeu.
 *
 *  - Classificador do CRM: devolve has_case = true quando a mensagem fala de
 *    demissão/salário, senão has_case = false.
 *  - Resposta ao cliente: "Resposta da IA para: <última mensagem>".
 *  - FAKE_AI_DELAY_MS atrasa a resposta ao cliente (corrida IA × atendente).
 *  - Mensagem com "erro-na-ia" faz a IA lançar erro.
 */
import fs from "fs";

function log(entry) {
  if (process.env.FAKE_AI_LOG) fs.appendFileSync(process.env.FAKE_AI_LOG, JSON.stringify(entry) + "\n");
}

async function respond(provider, messages, systemPrompt) {
  const last = messages[messages.length - 1]?.content || "";
  const isClassifier = String(systemPrompt).includes("classificador automático");
  log({ provider, kind: isClassifier ? "classifier" : "reply", messages, systemPrompt });

  if (isClassifier) {
    const hasCase = /demiti|salári|verbas/i.test(last);
    return JSON.stringify({
      has_case: hasCase,
      summary: hasCase ? last.slice(0, 200) : null,
      urgency_tag: hasCase ? "Alta" : null,
      area_tag: hasCase ? "Trabalhista" : null,
      name: null,
      email: null,
      address: null,
      birth_date: null,
    });
  }

  if (last.includes("erro-na-ia")) throw new Error("falha simulada da IA");
  const delay = Number(process.env.FAKE_AI_DELAY_MS || 0);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  return `Resposta da IA para: ${last.split("\n\n").pop()}`;
}

export async function sendToAnthropic(messages, systemPrompt) {
  return respond("anthropic", messages, systemPrompt);
}

export async function sendToOpenAI(messages, systemPrompt) {
  return respond("openai", messages, systemPrompt);
}
