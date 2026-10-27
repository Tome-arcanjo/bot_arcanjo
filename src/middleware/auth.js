import { forbiddenView } from "../controllers/dashboardController.js";

/**
 * Middleware que exige login para acessar o painel (dashboard + APIs).
 *
 * Duas exceções propositais:
 *  - /webhook/whatsapp: precisa continuar acessível sem login, senão a Meta
 *    não consegue mais entregar mensagens. Ele já é protegido de outra
 *    forma, pela validação de assinatura X-Hub-Signature-256.
 *  - /login e /logout: precisam ficar acessíveis ANTES do bloqueio, senão
 *    ninguém conseguiria nem chegar à tela de login.
 *
 * O usuário logado fica em req.session.user ({ id, name, email, role } —
 * id null e emergency: true no acesso de emergência do .env).
 */
export function requireAuth(req, res, next) {
  if (req.path.startsWith("/webhook/whatsapp")) return next();
  if (req.path === "/login" || req.path === "/logout") return next();

  if (req.session && req.session.user) {
    res.locals.user = req.session.user;
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, error: "Não autenticado. Faça login." });
  }

  return res.redirect("/login");
}

/** Só administradores (gestão de usuários, excluir casos, personalidade do bot). */
export function requireAdmin(req, res, next) {
  if (req.session?.user?.role === "admin") return next();

  if (req.originalUrl.startsWith("/api/")) {
    return res.status(403).json({ success: false, error: "Apenas administradores podem fazer isso." });
  }
  return forbiddenView(req, res);
}
