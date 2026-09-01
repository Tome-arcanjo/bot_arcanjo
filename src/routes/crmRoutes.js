import { Router } from "express";
import { getCases, createCase, updateCaseStatus, updateCaseTags, deleteCase } from "../services/crmService.js";

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

export default router;
