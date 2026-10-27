import { Router } from "express";
import {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  deleteUser,
  changeOwnPassword,
} from "../services/usersService.js";
import { requireAdmin } from "../middleware/auth.js";
import { loginRetryAfterMs, registerLoginFailure, clearLoginFailures } from "../utils/loginLimiter.js";

// Erros de regra (UserError) trazem o status HTTP; o resto é 500.
function sendError(res, error) {
  res.status(error.status || 500).json({ success: false, error: error.message });
}

function actorOf(req) {
  return req.session.user;
}

// ── /api/users (somente admin) ──────────────────────────────────────────
export const usersRouter = Router();
usersRouter.use(requireAdmin);

usersRouter.get("/", async (req, res) => {
  try {
    res.json({ success: true, data: await listUsers() });
  } catch (error) {
    sendError(res, error);
  }
});

usersRouter.post("/", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  try {
    const user = await createUser({ name, email, password, role });
    console.log(`[Usuários] ${actorOf(req).name} criou o usuário ${user.email} (${user.role}).`);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    sendError(res, error);
  }
});

usersRouter.patch("/:id", async (req, res) => {
  const { name, email, role, active } = req.body || {};
  try {
    const user = await updateUser(req.params.id, { name, email, role, active }, actorOf(req));
    console.log(`[Usuários] ${actorOf(req).name} alterou o usuário ${user.email}.`);
    res.json({ success: true, data: user });
  } catch (error) {
    sendError(res, error);
  }
});

usersRouter.post("/:id/password", async (req, res) => {
  try {
    await resetPassword(req.params.id, (req.body || {}).password);
    console.log(`[Usuários] ${actorOf(req).name} redefiniu a senha do usuário ${req.params.id}.`);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

usersRouter.delete("/:id", async (req, res) => {
  try {
    await deleteUser(req.params.id, actorOf(req));
    console.log(`[Usuários] ${actorOf(req).name} excluiu o usuário ${req.params.id}.`);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

// ── /api/me (qualquer usuário logado) ───────────────────────────────────
export const meRouter = Router();

meRouter.get("/", (req, res) => {
  res.json({ success: true, data: req.session.user });
});

meRouter.put("/password", async (req, res) => {
  const user = req.session.user;
  if (user.emergency) {
    return res.status(400).json({
      success: false,
      error: "Acesso de emergência: a senha é definida no .env (ADMIN_PASSWORD_HASH).",
    });
  }
  // Mesmo limite do login: impede adivinhar a senha atual de uma sessão
  // deixada aberta num computador compartilhado.
  if (loginRetryAfterMs(req.ip, user.email) > 0) {
    return res.status(429).json({ success: false, error: "Muitas tentativas. Tente novamente mais tarde." });
  }
  const { currentPassword, newPassword } = req.body || {};
  try {
    await changeOwnPassword(user.id, currentPassword, newPassword, req.sessionID);
    clearLoginFailures(req.ip, user.email);
    console.log(`[Usuários] ${user.name} trocou a própria senha.`);
    res.json({ success: true });
  } catch (error) {
    if (error.status === 403) registerLoginFailure(req.ip, user.email);
    sendError(res, error);
  }
});
