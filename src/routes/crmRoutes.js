import { Router } from "express";
import {
  getCases,
  getCaseById,
  createCase,
  updateCaseStatus,
  updateCaseTags,
  assignCase,
  deleteCase,
} from "../services/crmService.js";
import { scheduleCall, completeCall, cancelCall, getOverdueCallAlerts } from "../services/callService.js";
import { listCaseEvents } from "../services/caseEventsService.js";
import { listTeam, getUserById } from "../services/usersService.js";
import { CRM_COLUMNS, isValidStatus } from "../constants/crm.js";
import { requireAdmin } from "../middleware/auth.js";
import { openSseStream } from "../utils/sse.js";

const router = Router();

// Autor das ações feitas pelo painel (vai para o histórico e para o tempo real).
const actorOf = (req) => req.session.user;

// Retorna todos os casos
router.get("/cases", async (req, res) => {
  try {
    const cases = await getCases();
    res.json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Colunas do Kanban (mesma lista que o servidor usa para validar o status)
router.get("/columns", (req, res) => {
  res.json({ success: true, data: CRM_COLUMNS });
});

// Equipe ({ id, name, role, active }) para o seletor de responsável e os avatares
router.get("/users", async (req, res) => {
  try {
    res.json({ success: true, data: await listTeam() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tempo real do quadro: cada criação/movimentação/atribuição/exclusão/ligação
// feita por qualquer pessoa (ou pela IA) chega aqui como evento "crm".
router.get("/stream", (req, res) => {
  openSseStream(req, res, [{ on: "crmChanged", event: "crm" }]);
});

// Cria um novo caso manualmente no painel
router.post("/cases", async (req, res) => {
  const { phone, clientName, summary } = req.body || {};
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  if (!cleanPhone) {
    return res.status(400).json({ success: false, error: "Telefone é obrigatório." });
  }
  try {
    const newCase = await createCase(cleanPhone, (clientName || "").trim(), (summary || "").trim(), actorOf(req));
    if (!newCase) {
      return res.status(500).json({ success: false, error: "Não foi possível criar o caso." });
    }
    res.json({ success: true, data: newCase });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Exclui um caso permanentemente — só admin
router.delete("/cases/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const ok = await deleteCase(id, actorOf(req));
    if (!ok) {
      return res.status(500).json({ success: false, error: "Não foi possível excluir o caso." });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualiza o status (arrastar no Kanban). Se duas pessoas moverem o mesmo
// card, vale a última gravação — e o tempo real mostra o resultado a todos.
router.patch("/cases/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!isValidStatus(status)) {
    return res.status(400).json({ success: false, error: "Coluna (status) inválida." });
  }
  try {
    const updated = await updateCaseStatus(id, status, actorOf(req));
    if (!updated) {
      const exists = await getCaseById(id);
      return exists
        ? res.status(500).json({ success: false, error: "Não foi possível mover o caso." })
        : res.status(404).json({ success: false, error: "Caso não encontrado (pode ter sido excluído)." });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualiza as etiquetas (urgência e área)
router.patch("/cases/:id/tags", async (req, res) => {
  const { id } = req.params;
  const { urgency_tag, area_tag } = req.body || {};
  try {
    const updated = await updateCaseTags(id, urgency_tag, area_tag, actorOf(req));
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atribui/transfere o caso: { userId } (null = sem responsável). Sempre humano.
router.patch("/cases/:id/assign", async (req, res) => {
  const { userId } = req.body || {};
  try {
    let assignee = null;
    if (userId) {
      const user = await getUserById(userId);
      if (!user || !user.active) {
        return res.status(400).json({ success: false, error: "Responsável inválido ou desativado." });
      }
      assignee = { id: user.id, name: user.name };
    }
    const updated = await assignCase(req.params.id, assignee, actorOf(req));
    if (!updated) return res.status(404).json({ success: false, error: "Caso não encontrado (pode ter sido excluído)." });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Histórico do caso (case_events), do mais recente para o mais antigo
router.get("/cases/:id/events", async (req, res) => {
  try {
    res.json({ success: true, data: await listCaseEvents(req.params.id) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Ligação com o advogado ──────────────────────────────────────────────

// Erros de regra de negócio (CallError) trazem o status HTTP; o resto é 500.
function sendCallError(res, error) {
  const status = error.status || 500;
  res.status(status).json({ success: false, error: error.message });
}

// Ligações pendentes já atrasadas (dentro da janela de 3h de avisos) — o painel
// consulta isto para notificar o admin no navegador.
router.get("/calls/overdue", async (req, res) => {
  try {
    res.json({ success: true, data: await getOverdueCallAlerts() });
  } catch (error) {
    sendCallError(res, error);
  }
});

// Agenda a ligação — ou remarca, se já houver uma pendente (o cliente é avisado).
router.put("/cases/:id/call", async (req, res) => {
  const { scheduledAt } = req.body || {};
  try {
    const { case: updated, isReschedule, clientNotified } = await scheduleCall(req.params.id, scheduledAt, actorOf(req));
    res.json({ success: true, data: updated, rescheduled: isReschedule, clientNotified });
  } catch (error) {
    sendCallError(res, error);
  }
});

// Marca a ligação como concluída.
router.post("/cases/:id/call/complete", async (req, res) => {
  try {
    const { case: updated } = await completeCall(req.params.id, actorOf(req));
    res.json({ success: true, data: updated });
  } catch (error) {
    sendCallError(res, error);
  }
});

// Cancela a ligação (o cliente é avisado).
router.delete("/cases/:id/call", async (req, res) => {
  try {
    const { case: updated, clientNotified } = await cancelCall(req.params.id, actorOf(req));
    res.json({ success: true, data: updated, clientNotified });
  } catch (error) {
    sendCallError(res, error);
  }
});

export default router;
