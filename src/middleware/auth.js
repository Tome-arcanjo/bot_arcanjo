/**
 * Middleware que exige login para acessar o painel (chat web + admin + CRM).
 *
 * Duas exceções propositais:
 *  - /webhook/whatsapp: precisa continuar acessível sem login, senão a Meta
 *    não consegue mais entregar mensagens. Ele já é protegido de outra
 *    forma, pela validação de assinatura X-Hub-Signature-256.
 *  - /login e /logout: precisam ficar acessíveis ANTES do bloqueio, senão
 *    ninguém conseguiria nem chegar à tela de login.
 */
export function requireAuth(req, res, next) {
  if (req.path.startsWith("/webhook/whatsapp")) return next();
  if (req.path === "/login" || req.path === "/logout") return next();

  if (req.session && req.session.authenticated) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, error: "Não autenticado. Faça login." });
  }

  return res.redirect("/login");
}
