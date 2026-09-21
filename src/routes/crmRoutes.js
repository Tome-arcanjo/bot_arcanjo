import { Router } from "express";
import { getCases, createCase, updateCaseStatus, updateCaseTags, deleteCase } from "../services/crmService.js";
import { scheduleCall, completeCall, cancelCall, getOverdueCallAlerts } from "../services/callService.js";

const router = Router();

// Retorna todos os casos
router.get("/cases", async (req, res) => {
  try {
    const cases = await getCases();
    res.json({ success: true, data: cases });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cria um novo caso manualmente no painel
router.post("/cases", async (req, res) => {
  const { phone, clientName, summary } = req.body || {};
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  if (!cleanPhone) {
    return res.status(400).json({ success: false, error: "Telefone é obrigatório." });
  }
  try {
    const newCase = await createCase(cleanPhone, (clientName || "").trim(), (summary || "").trim());
    if (!newCase) {
      return res.status(500).json({ success: false, error: "Não foi possível criar o caso." });
    }
    res.json({ success: true, data: newCase });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Exclui um caso permanentemente
router.delete("/cases/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const ok = await deleteCase(id);
    if (!ok) {
      return res.status(500).json({ success: false, error: "Não foi possível excluir o caso." });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualiza o status (arrastar no Kanban)
router.patch("/cases/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const updated = await updateCaseStatus(id, status);
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualiza as etiquetas (urgência e área)
router.patch("/cases/:id/tags", async (req, res) => {
  const { id } = req.params;
  const { urgency_tag, area_tag } = req.body;
  try {
    const updated = await updateCaseTags(id, urgency_tag, area_tag);
    res.json({ success: true, data: updated });
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
    const { case: updated, isReschedule, clientNotified } = await scheduleCall(req.params.id, scheduledAt);
    res.json({ success: true, data: updated, rescheduled: isReschedule, clientNotified });
  } catch (error) {
    sendCallError(res, error);
  }
});

// Marca a ligação como concluída.
router.post("/cases/:id/call/complete", async (req, res) => {
  try {
    const { case: updated } = await completeCall(req.params.id);
    res.json({ success: true, data: updated });
  } catch (error) {
    sendCallError(res, error);
  }
});

// Cancela a ligação (o cliente é avisado).
router.delete("/cases/:id/call", async (req, res) => {
  try {
    const { case: updated, clientNotified } = await cancelCall(req.params.id);
    res.json({ success: true, data: updated, clientNotified });
  } catch (error) {
    sendCallError(res, error);
  }
});

export default router;
