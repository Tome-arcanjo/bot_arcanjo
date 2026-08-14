import { Router } from "express";
import {
  createSessionController,
  listSessionsController,
  deleteSessionController,
  getMessagesController,
  sendMessageController,
} from "../controllers/chatController.js";

const router = Router();

// Sessoes
router.post("/sessions", createSessionController);
router.get("/sessions", listSessionsController);
router.delete("/sessions/:id", deleteSessionController);

// Mensagens
router.get("/sessions/:id/messages", getMessagesController);
router.post("/sessions/:id/message", sendMessageController);

export default router;
