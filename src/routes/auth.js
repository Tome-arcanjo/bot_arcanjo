import { Router } from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

const router = Router();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

router.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect("/dashboard");
  res.send(buildLoginHTML());
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!ADMIN_PASSWORD_HASH) {
    console.error("[Auth] ADMIN_PASSWORD_HASH não configurado no .env — login está bloqueado.");
    return res.send(
      buildLoginHTML(
        "Login não configurado no servidor. Gere uma senha com scripts/gerar-senha.js e adicione ADMIN_PASSWORD_HASH ao .env."
      )
    );
  }

  const validUsername = typeof username === "string" && username === ADMIN_USERNAME;
  const validPassword =
    typeof password === "string" &&
    password.length > 0 &&
    (await bcrypt.compare(password, ADMIN_PASSWORD_HASH));

  if (validUsername && validPassword) {
    req.session.authenticated = true;
    return res.redirect("/dashboard");
  }

  console.warn(`[Auth] Tentativa de login falhou para usuário "${username}"`);
  res.send(buildLoginHTML("Usuário ou senha incorretos."));
});

router.get("/logout", (req, res) => {
  if (req.session) {
    req.session.destroy(() => res.redirect("/login"));
  } else {
    res.redirect("/login");
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildLoginHTML(error) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Miguel Arcanjo Advocacia — Login</title>
  <link rel="icon" href="/img/symbol-gold.png" />
  <link rel="stylesheet" href="/css/brand.css" />
  <style>
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
      background: var(--brand-black);
      background-image: radial-gradient(circle at 15% 15%, rgba(211,161,74,0.08), transparent 45%);
    }
    .login-card {
      background: var(--brand-dark); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-lg);
      padding: 44px 40px; width: 100%; max-width: 400px; box-shadow: var(--shadow-md);
    }
    .login-logo { display: block; height: 30px; width: auto; margin-bottom: 30px; }
    .subtitle { color: var(--text-on-dark-muted); font-size: 0.88rem; margin-bottom: 30px; }
    label { display: block; font-size: 0.82rem; color: var(--text-on-dark-muted); margin-bottom: 6px; font-weight: 500; }
    input {
      width: 100%; padding: 12px 14px; margin-bottom: 20px; background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12); border-radius: var(--radius-sm); color: var(--text-on-dark);
      font-size: 0.92rem; font-family: inherit;
    }
    input:focus { outline: none; border-color: var(--brand-gold); }
    button {
      width: 100%; padding: 13px; background: var(--brand-gold); color: #1a1206; border: none;
      border-radius: var(--radius-sm); font-size: 0.92rem; font-weight: 700; cursor: pointer;
      font-family: inherit; transition: filter 0.15s;
    }
    button:hover { filter: brightness(0.94); }
    .error-msg {
      background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35); color: #f87171;
      padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.84rem; margin-bottom: 20px;
    }
  </style>
</head>
<body class="dashboard-body">
  <div class="login-card">
    <img class="login-logo" src="/img/logo-white.png" alt="Miguel Arcanjo Advocacia" />
    <div class="subtitle">Acesso restrito ao painel</div>
    ${error ? `<div class="error-msg">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="/login">
      <label for="username">Usuário</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus />
      <label for="password">Senha</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

export default router;
