import { Router } from "express";
import { verifyWebhook, receiveMessage } from "../controllers/whatsappController.js";

const router = Router();

// Endpoint para verificação inicial da Meta
router.get("/", verifyWebhook);

// Endpoint para receber mensagens via webhook
router.post("/", receiveMessage);

export default router;
