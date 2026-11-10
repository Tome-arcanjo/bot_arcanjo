import { Router } from "express";
import { listClients, setClientTags } from "../services/clientsService.js";

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

// PUT /api/contatos/:phone/tags { tags: [ids] } — etiquetas jurídicas do cliente
// (ids de src/constants/tags.js; 400 se algum não existir). Todos veem pelo SSE.
router.put("/:phone/tags", async (req, res) => {
  try {
    const client = await setClientTags(req.params.phone, (req.body || {}).tags, req.session.user);
    res.json({ success: true, data: client });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

export default router;
