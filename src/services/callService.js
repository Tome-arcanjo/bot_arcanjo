import "dotenv/config";
import { getCaseById, updateCaseCall, getOverdueCalls, claimCallReminder } from "./crmService.js";
import { sendWhatsAppMessage } from "./whatsappService.js";
import { recordAssistantMessage } from "./chatService.js";

/**
 * Ligação do cliente com o advogado.
 *
 * O admin agenda/remarca/cancela/conclui pelo card do caso no CRM (nunca a IA —
 * mesma regra do restante do CRM). Este serviço cuida de:
 *  - avisar o CLIENTE, pelo próprio bot, quando o horário é remarcado ou a
 *    ligação é cancelada;
 *  - avisar o ADMIN (WhatsApp, números em CALL_ALERT_PHONES) quando uma ligação
 *    pendente passa do horário: um aviso assim que atrasa e repete a cada
 *    30 minutos por 3 horas.
 */

const TIMEZONE = process.env.APP_TIMEZONE || "America/Sao_Paulo";

const CHECK_INTERVAL_MS = 60 * 1000; // frequência do agendador
export const REMINDER_INTERVAL_MS = 30 * 60 * 1000; // repete a cada 30 min
export const REMINDER_WINDOW_MS = 3 * 60 * 60 * 1000; // ...durante 3 horas
// Avisos em +0, +30, ..., +180 min depois do horário marcado.
export const MAX_REMINDERS = REMINDER_WINDOW_MS / REMINDER_INTERVAL_MS + 1;
// Folga além das 3h para o último aviso (+180 min) ainda poder sair no tick seguinte.
export const REMINDER_CUTOFF_MS = REMINDER_WINDOW_MS + 5 * 60 * 1000;

// Erro de regra de negócio/validação, com o status HTTP que a rota deve devolver.
export class CallError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDateTime(value) {
  return new Date(value)
    .toLocaleString("pt-BR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(", ", " às ");
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function greeting(crmCase) {
  const firstName = (crmCase.client_name || "").trim().split(/\s+/)[0];
  return firstName ? `Olá, ${firstName}!` : "Olá!";
}

function adminPhones() {
  return (process.env.CALL_ALERT_PHONES || "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean);
}

/**
 * Decide se há um aviso de atraso a enviar agora. Função pura (sem I/O).
 *
 * O aviso nº N (N = 1..MAX_REMINDERS) vale a partir de horário + (N-1)*30 min.
 * Se o servidor ficou fora do ar e vários avisos ficaram para trás, sai só UM
 * (o do intervalo atual) — nunca uma rajada — e o contador pula para ele.
 *
 * @returns {{ newSent: number, overdueMs: number } | null}
 */
export function computeDueReminder(scheduledAtMs, remindersSent, nowMs) {
  const overdueMs = nowMs - scheduledAtMs;
  if (overdueMs < 0 || overdueMs > REMINDER_CUTOFF_MS) return null;

  const slot = Math.min(Math.floor(overdueMs / REMINDER_INTERVAL_MS), MAX_REMINDERS - 1);
  if (slot < remindersSent) return null; // esse intervalo já foi avisado
  return { newSent: slot + 1, overdueMs };
}

/**
 * Envia uma mensagem do bot ao cliente e registra no histórico da conversa.
 * Retorna true se o WhatsApp aceitou a mensagem.
 *
 * Atenção: a API da Meta só aceita texto livre dentro de 24h da última mensagem
 * do cliente. Fora dessa janela o envio falha (é logado e o painel avisa o admin).
 */
async function notifyClient(phone, text) {
  const to = String(phone || "").replace(/\D/g, "");
  if (!to) return false;

  try {
    const sent = await sendWhatsAppMessage(to, text);
    if (!sent) return false; // WhatsApp não configurado (o service já logou o aviso)
  } catch (error) {
    console.error(`[Ligação] Não foi possível avisar o cliente ${to}:`, error.message);
    return false;
  }

  try {
    await recordAssistantMessage(to, text);
  } catch (error) {
    // A mensagem já chegou ao cliente; só o registro no painel falhou.
    console.error(`[Ligação] Aviso enviado a ${to}, mas não foi possível registrar no histórico:`, error.message);
  }
  return true;
}

// ── Ações do admin ──────────────────────────────────────────────────────

async function loadCase(caseId) {
  const crmCase = await getCaseById(caseId);
  if (!crmCase) throw new CallError("Caso não encontrado.", 404);
  return crmCase;
}

function requirePendingCall(crmCase) {
  if (crmCase.call_status !== "pendente" || !crmCase.call_scheduled_at) {
    throw new CallError("Este caso não tem ligação pendente.", 409);
  }
}

/**
 * Agenda uma ligação — ou remarca, se já houver uma pendente. Na remarcação o
 * cliente é avisado pelo bot do novo horário.
 */
export async function scheduleCall(caseId, scheduledAtInput) {
  const scheduledAt = new Date(scheduledAtInput);
  if (!scheduledAtInput || Number.isNaN(scheduledAt.getTime())) {
    throw new CallError("Data e hora da ligação inválidas.");
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw new CallError("O horário da ligação precisa estar no futuro.");
  }

  const existing = await loadCase(caseId);
  const isReschedule = existing.call_status === "pendente" && Boolean(existing.call_scheduled_at);

  if (isReschedule && new Date(existing.call_scheduled_at).getTime() === scheduledAt.getTime()) {
    return { case: existing, isReschedule: true, clientNotified: null }; // nada mudou
  }

  const updated = await updateCaseCall(caseId, {
    call_status: "pendente",
    call_scheduled_at: scheduledAt.toISOString(),
    call_completed_at: null,
    call_reminders_sent: 0, // recomeça a contagem de avisos de atraso
  });
  if (!updated) throw new CallError("Caso não encontrado.", 404);

  let clientNotified = null;
  if (isReschedule) {
    clientNotified = await notifyClient(
      existing.phone,
      `${greeting(existing)} O horário da sua ligação com o advogado foi alterado.\n\n` +
        `Horário anterior: ${formatDateTime(existing.call_scheduled_at)}\n` +
        `Novo horário: ${formatDateTime(scheduledAt)}\n\n` +
        `Qualquer dúvida, é só responder por aqui.`
    );
  }

  console.log(`[Ligação] Caso ${caseId}: ligação ${isReschedule ? "remarcada" : "agendada"} para ${scheduledAt.toISOString()}.`);
  return { case: updated, isReschedule, clientNotified };
}

/** Marca a ligação pendente como concluída (encerra os avisos de atraso). */
export async function completeCall(caseId) {
  const existing = await loadCase(caseId);
  requirePendingCall(existing);

  const updated = await updateCaseCall(caseId, {
    call_status: "concluida",
    call_completed_at: new Date().toISOString(),
  });
  if (!updated) throw new CallError("Caso não encontrado.", 404);

  console.log(`[Ligação] Caso ${caseId}: ligação concluída.`);
  return { case: updated };
}

/** Cancela a ligação pendente e avisa o cliente pelo bot. */
export async function cancelCall(caseId) {
  const existing = await loadCase(caseId);
  requirePendingCall(existing);

  const updated = await updateCaseCall(caseId, {
    call_status: null,
    call_scheduled_at: null,
    call_completed_at: null,
    call_reminders_sent: 0,
  });
  if (!updated) throw new CallError("Caso não encontrado.", 404);

  const clientNotified = await notifyClient(
    existing.phone,
    `${greeting(existing)} Informamos que a ligação com o advogado marcada para ` +
      `${formatDateTime(existing.call_scheduled_at)} foi cancelada.\n\n` +
      `Se quiser remarcar, é só nos avisar por aqui.`
  );

  console.log(`[Ligação] Caso ${caseId}: ligação cancelada.`);
  return { case: updated, clientNotified };
}

// ── Avisos de atraso (agendador) ────────────────────────────────────────

async function sendOverdueAlert(crmCase, { newSent, overdueMs }) {
  const who = crmCase.client_name ? `${crmCase.client_name} (${crmCase.phone})` : crmCase.phone;
  const text =
    `⏰ *Ligação atrasada*\n\n` +
    `Cliente: ${who}\n` +
    `Horário marcado: ${formatDateTime(crmCase.call_scheduled_at)}\n` +
    `Atraso: ${formatDuration(overdueMs)}\n\n` +
    `Aviso ${newSent} de ${MAX_REMINDERS}${newSent === MAX_REMINDERS ? " (último)" : ""}. ` +
    `Conclua, remarque ou cancele a ligação no CRM.`;

  const phones = adminPhones();
  if (phones.length === 0) {
    console.warn(
      `[Ligação] Ligação do caso ${crmCase.id} está atrasada (${formatDuration(overdueMs)}), mas CALL_ALERT_PHONES não está configurado — ` +
        `só o painel do CRM mostra o atraso.`
    );
    return;
  }

  const results = await Promise.allSettled(phones.map((to) => sendWhatsAppMessage(to, text)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[Ligação] Falha ao avisar ${phones[i]} sobre o atraso do caso ${crmCase.id}:`, r.reason?.message);
    }
  });
  console.log(`[Ligação] Aviso ${newSent}/${MAX_REMINDERS} de atraso do caso ${crmCase.id} enviado a ${phones.length} número(s).`);
}

let timer = null;
let running = false;
let lastErrorMessage = null;

/** Uma passada do agendador: envia os avisos de atraso que estiverem vencidos. */
export async function runReminderCheck(now = Date.now()) {
  if (running) return; // ciclo anterior ainda em andamento
  running = true;

  try {
    const overdue = await getOverdueCalls(
      new Date(now).toISOString(),
      new Date(now - REMINDER_CUTOFF_MS).toISOString()
    );
    lastErrorMessage = null;

    for (const crmCase of overdue) {
      try {
        const sent = crmCase.call_reminders_sent || 0;
        const due = computeDueReminder(Date.parse(crmCase.call_scheduled_at), sent, now);
        if (!due) continue;

        // Reserva o aviso ANTES de enviar: se der erro no envio, a próxima
        // tentativa é só no intervalo seguinte (30 min) — nunca em dobro.
        const claimed = await claimCallReminder(crmCase.id, sent, due.newSent);
        if (!claimed) continue;

        await sendOverdueAlert(crmCase, due);
      } catch (error) {
        console.error(`[Ligação] Erro ao processar aviso de atraso do caso ${crmCase.id}:`, error.message);
      }
    }
  } catch (error) {
    // Ex.: migração das colunas call_* ainda não aplicada. Loga uma vez por
    // tipo de erro, para não encher o log a cada minuto.
    if (error.message !== lastErrorMessage) {
      console.error("[Ligação] Não foi possível verificar ligações atrasadas:", error.message);
      lastErrorMessage = error.message;
    }
  } finally {
    running = false;
  }
}

/** Liga o agendador de avisos de atraso (chamado uma vez no boot do servidor). */
export function startCallReminderScheduler() {
  if (timer) return;
  timer = setInterval(() => runReminderCheck(), CHECK_INTERVAL_MS);
  runReminderCheck(); // já verifica no boot (recupera avisos perdidos durante uma queda)
  console.log("[Ligação] Agendador de avisos de ligação atrasada iniciado (verifica a cada 1 min).");
}
