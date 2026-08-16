import { sendToAnthropic } from "../providers/anthropic.js";
import { sendToOpenAI } from "../providers/openai.js";
import { getCaseByPhone, createCase, updateCaseTags } from "./crmService.js";

/**
 * Prompt de classificação. Importante: a IA aqui tem UMA função só —
 * classificar o que o cliente relatou. Ela nunca decide o andamento do
 * caso, nunca dá conselho jurídico e nunca deve inventar informação que
 * o cliente não forneceu. O avanço do caso pelas colunas do Kanban
 * (status) continua 100% manual, feito por uma pessoa.
 */
const CLASSIFIER_SYSTEM_PROMPT = `Você é um classificador automático de mensagens de WhatsApp para um escritório de advocacia trabalhista. Sua ÚNICA tarefa é ler a mensagem do cliente e classificá-la — você NÃO dá conselhos jurídicos, NÃO toma decisões e NÃO deve inventar nenhuma informação que o cliente não tenha dito.

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, sem markdown, no formato exato:

{"has_case": true ou false, "summary": "resumo curto e factual (até 200 caracteres) do que o cliente relatou, ou null", "urgency_tag": "Crítico" ou "Alta" ou "Normal" ou "Baixa" ou null, "area_tag": "área do direito em 1 a 3 palavras (ex: Trabalhista, Rescisão, Previdenciário) ou null"}

Regras:
- "has_case": true SOMENTE se o cliente descreveu um problema, dúvida jurídica concreta ou situação que precise de acompanhamento (ex: demissão, falta de pagamento, assédio, acidente de trabalho). Saudações, agradecimentos ou perguntas genéricas devem ter has_case: false.
- "urgency_tag": "Crítico" apenas para risco imediato (ex: demissão iminente, prazo legal vencendo); "Alta" quando já há prejuízo financeiro ativo (ex: falta de pagamento em andamento); "Normal" para dúvidas sem urgência clara; "Baixa" para perguntas informativas.
- Resuma apenas o que foi dito — nunca acrescente suposições, diagnósticos ou dados que o cliente não informou.
- Na dúvida, responda has_case: false.`;

function parseClassification(raw) {
  if (!raw) return null;
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.has_case !== "boolean") return null;
    return parsed;
  } catch (e) {
    console.error("[CRM Classifier] Resposta da IA não é um JSON válido:", raw);
    return null;
  }
}

async function callClassifier(userContent, provider) {
  const messages = [{ role: "user", content: userContent }];
  const raw =
    provider === "openai"
      ? await sendToOpenAI(messages, CLASSIFIER_SYSTEM_PROMPT)
      : await sendToAnthropic(messages, CLASSIFIER_SYSTEM_PROMPT);
  return parseClassification(raw);
}

/**
 * Classifica a mensagem do cliente e cria/atualiza o caso correspondente
 * no CRM. Roda em segundo plano (fire-and-forget, chamado sem "await" por
 * quem invoca) — qualquer erro aqui é só logado, nunca deve interromper
 * ou atrasar a resposta enviada ao cliente no WhatsApp.
 *
 * A IA só classifica (resumo + urgência + área). Ela nunca:
 *  - decide ou altera o status/coluna do Kanban (isso é sempre manual);
 *  - reescreve o resumo de um caso já existente (preserva o que a pessoa
 *    responsável já escreveu, só atualiza urgência/área se mudar);
 *  - cria um caso quando a mensagem não descreve um problema concreto.
 */
export async function classifyAndUpdateCrmCase({ phone, userContent, provider }) {
  if (!phone || !userContent) return;

  try {
    const result = await callClassifier(userContent, provider);
    if (!result || !result.has_case) return;

    const existingCase = await getCaseByPhone(phone);

    if (existingCase) {
      // Caso já existe: atualiza só a classificação (urgência/área), se
      // vier algo novo. O resumo escrito por humano e o status não são
      // tocados pela IA.
      const urgency = result.urgency_tag || existingCase.urgency_tag;
      const area = result.area_tag || existingCase.area_tag;
      if (urgency !== existingCase.urgency_tag || area !== existingCase.area_tag) {
        await updateCaseTags(existingCase.id, urgency, area);
      }
      return;
    }

    // Cria um caso novo — sempre começa na coluna padrão "Novo caso"
    // (definida pelo próprio banco), nunca escolhida pela IA.
    const newCase = await createCase(phone, null, result.summary || "");
    if (newCase && (result.urgency_tag || result.area_tag)) {
      await updateCaseTags(newCase.id, result.urgency_tag || "Normal", result.area_tag || null);
    }
  } catch (error) {
    console.error("[CRM Classifier] Erro ao classificar mensagem:", error.message);
  }
}
