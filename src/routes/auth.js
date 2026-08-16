import { Router } from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";

const router = Router();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

router.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect("/");
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
    return res.redirect("/");
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
  <title>Bot Arcanjo — Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f0f13; --surface: #16161e; --border: #2a2a3a;
      --accent: #7c6fe0; --accent-hover: #9585f5; --text: #e8e8f0; --muted: #8888aa;
      --error: #ef4444;
    }
    body {
      font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text);
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .login-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
      padding: 40px 36px; width: 100%; max-width: 380px;
    }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 1.3rem; font-weight: 700; }
    .logo span { color: var(--accent); }
    .subtitle { color: var(--muted); font-size: 0.88rem; margin-bottom: 28px; }
    label { display: block; font-size: 0.82rem; color: var(--muted); margin-bottom: 6px; font-weight: 500; }
    input {
      width: 100%; padding: 11px 14px; margin-bottom: 18px; background: var(--bg);
      border: 1px solid var(--border); border-radius: 8px; color: var(--text);
      font-size: 0.92rem; font-family: inherit;
    }
    input:focus { outline: none; border-color: var(--accent); }
    button {
      width: 100%; padding: 12px; background: var(--accent); color: white; border: none;
      border-radius: 8px; font-size: 0.92rem; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: background 0.15s;
    }
    button:hover { background: var(--accent-hover); }
    .error-msg {
      background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--error);
      padding: 10px 14px; border-radius: 8px; font-size: 0.84rem; margin-bottom: 18px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo">⚡ Bot <span>Arcanjo</span></div>
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
