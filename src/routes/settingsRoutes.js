import { Router } from "express";
import { getSettings, updateSettings } from "../services/settingsService.js";

const router = Router();

// Buscar as configurações atuais
router.get("/", (req, res) => {
  try {
    const settings = getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar configurações." });
  }
});

// Atualizar o system prompt (personalidade/contexto)
router.post("/", async (req, res) => {
  try {
    const { systemPrompt } = req.body;
    
    if (!systemPrompt) {
      return res.status(400).json({ error: "O campo systemPrompt é obrigatório." });
    }

    const newSettings = await updateSettings(systemPrompt);
    res.json({ success: true, settings: newSettings });
  } catch (error) {
    res.status(500).json({ error: "Erro ao salvar configurações." });
  }
});

export default router;
