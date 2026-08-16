import { sendToAnthropic } from "../providers/anthropic.js";
import { sendToOpenAI } from "../providers/openai.js";
import { getCaseByPhone, createCase, updateCaseTags } from "./crmService.js";
import { upsertClientInfo } from "./clientsService.js";

/**
 * Prompt de classificação. Importante: a IA aqui tem UMA função só —
 * classificar o que o cliente relatou e transcrever dados de contato que
 * ele mesmo forneceu. Ela nunca decide o andamento do caso, nunca dá
 * conselho jurídico e nunca deve inventar informação que o cliente não
 * forneceu. O avanço do caso pelas colunas do Kanban (status) continua
 * 100% manual, feito por uma pessoa.
 */
const CLASSIFIER_SYSTEM_PROMPT = `Você é um classificador automático de mensagens de WhatsApp para um escritório de advocacia trabalhista. Sua ÚNICA tarefa é ler a mensagem do cliente e classificá-la — você NÃO dá conselhos jurídicos, NÃO toma decisões e NÃO deve inventar nenhuma informação que o cliente não tenha dito.

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, sem markdown, no formato exato:

{"has_case": true ou false, "summary": "resumo curto e factual (até 200 caracteres) do que o cliente relatou, ou null", "urgency_tag": "Crítico" ou "Alta" ou "Normal" ou "Baixa" ou null, "area_tag": "área do direito em 1 a 3 palavras (ex: Trabalhista, Rescisão, Previdenciário) ou null", "name": "nome completo do cliente, SOMENTE se ele disse explicitamente nesta mensagem, ou null", "email": "e-mail do cliente, SOMENTE se ele disse explicitamente nesta mensagem, ou null", "address": "endereço do cliente, SOMENTE se ele disse explicitamente nesta mensagem, ou null", "birth_date": "data de nascimento no formato AAAA-MM-DD, SOMENTE se ele disse explicitamente nesta mensagem, ou null"}

Regras:
- "has_case": true SOMENTE se o cliente descreveu um problema, dúvida jurídica concreta ou situação que precise de acompanhamento (ex: demissão, falta de pagamento, assédio, acidente de trabalho). Saudações, agradecimentos ou perguntas genéricas devem ter has_case: false.
- "urgency_tag": "Crítico" apenas para risco imediato (ex: demissão iminente, prazo legal vencendo); "Alta" quando já há prejuízo financeiro ativo (ex: falta de pagamento em andamento); "Normal" para dúvidas sem urgência clara; "Baixa" para perguntas informativas.
- Os campos "name", "email", "address" e "birth_date" são TRANSCRIÇÃO, não interpretação: só preencha se o cliente escreveu essa informação literalmente nesta mensagem. Nunca deduza nome a partir do jeito de escrever, nunca invente e-mail, nunca calcule data de nascimento a partir de idade mencionada.
- Resuma apenas o que foi dito — nunca acrescente suposições, diagnósticos ou dados que o cliente não informou.
- Na dúvida, responda has_case: false e deixe os campos de contato como null.`;

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

// Datas de nascimento vêm da IA em formato livre (mesmo pedindo AAAA-MM-DD
// no prompt); valida antes de gravar, pra nunca salvar lixo no banco.
function isValidDate(value) {
  if (!value || typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

async function maybeSaveContactInfo(phone, result) {
  const fields = {};
  if (result.name) fields.name = String(result.name).slice(0, 200);
  if (result.email) fields.email = String(result.email).slice(0, 200);
  if (result.address) fields.address = String(result.address).slice(0, 300);
  if (isValidDate(result.birth_date)) fields.birth_date = result.birth_date;

  if (Object.keys(fields).length === 0) return;

  const saved = await upsertClientInfo(phone, fields);
  if (saved) {
    console.log(`[CRM Classifier] Contato atualizado para ${phone}: ${Object.keys(fields).join(", ")}`);
  }
}

/**
 * Classifica a mensagem do cliente, cria/atualiza o caso correspondente
 * no CRM e — quando o cliente fornece algum dado de contato na própria
 * mensagem — atualiza o cadastro em Contatos. Roda em segundo plano
 * (fire-and-forget, chamado sem "await" por quem invoca) — qualquer erro
 * aqui é só logado, nunca deve interromper ou atrasar a resposta enviada
 * ao cliente no WhatsApp.
 *
 * A IA só classifica/transcreve. Ela nunca:
 *  - decide ou altera o status/coluna do Kanban (isso é sempre manual);
 *  - reescreve o resumo de um caso já existente (preserva o que a pessoa
 *    responsável já escreveu, só atualiza urgência/área se mudar);
 *  - cria um caso quando a mensagem não descreve um problema concreto;
 *  - inventa dados de contato — só transcreve o que o cliente escreveu.
 */
export async function classifyAndUpdateCrmCase({ phone, userContent, provider }) {
  if (!phone || !userContent) return;

  console.log(`[CRM Classifier] Analisando mensagem de ${phone}...`);

  try {
    const result = await callClassifier(userContent, provider);

    if (!result) {
      console.log(`[CRM Classifier] Não foi possível interpretar a resposta da IA para ${phone} — nada foi salvo.`);
      return;
    }

    // Dados de contato podem vir em qualquer mensagem, independente de ser
    // ou não um caso jurídico — por isso essa checagem é separada do
    // "has_case" abaixo.
    await maybeSaveContactInfo(phone, result);

    if (!result.has_case) {
      console.log(`[CRM Classifier] Mensagem de ${phone} não foi classificada como caso (has_case=false).`);
      return;
    }

    console.log(`[CRM Classifier] Caso detectado para ${phone}: urgência=${result.urgency_tag}, área=${result.area_tag}, resumo="${result.summary}"`);

    const existingCase = await getCaseByPhone(phone);

    if (existingCase) {
      // Caso já existe: atualiza só a classificação (urgência/área), se
      // vier algo novo. O resumo escrito por humano e o status não são
      // tocados pela IA.
      const urgency = result.urgency_tag || existingCase.urgency_tag;
      const area = result.area_tag || existingCase.area_tag;
      if (urgency !== existingCase.urgency_tag || area !== existingCase.area_tag) {
        await updateCaseTags(existingCase.id, urgency, area);
        console.log(`[CRM Classifier] Caso existente (id: ${existingCase.id}) atualizado para ${phone}.`);
      }
      return;
    }

    // Cria um caso novo — sempre começa na coluna padrão "Novo caso"
    // (definida pelo próprio banco), nunca escolhida pela IA.
    const newCase = await createCase(phone, result.name || null, result.summary || "");
    if (!newCase) {
      console.error(`[CRM Classifier] createCase() retornou null para ${phone} — provável erro ao gravar no Supabase.`);
      return;
    }
    if (result.urgency_tag || result.area_tag) {
      await updateCaseTags(newCase.id, result.urgency_tag || "Normal", result.area_tag || null);
    }
    console.log(`[CRM Classifier] Novo caso criado para ${phone} (id: ${newCase.id}).`);
  } catch (error) {
    console.error(`[CRM Classifier] Erro ao classificar mensagem de ${phone}:`, error.message);
  }
}
