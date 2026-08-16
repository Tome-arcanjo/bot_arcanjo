import { Router } from "express";
import { listClients } from "../services/clientsService.js";

const router = Router();

// GET /api/contatos?search=... — lista contatos capturados pela IA,
// com filtro opcional por nome/telefone/e-mail.
router.get("/", async (req, res) => {
  try {
    const clients = await listClients({ search: req.query.search });
    res.json({ success: true, data: clients });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
