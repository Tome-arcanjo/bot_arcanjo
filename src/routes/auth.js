import { Router } from "express";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { loginRetryAfterMs, registerLoginFailure, clearLoginFailures } from "../utils/loginLimiter.js";
import { verifyCredentials, sessionUser } from "../services/usersService.js";

const router = Router();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

// Acesso de emergência (ADMIN_USERNAME/ADMIN_PASSWORD_HASH do .env): admin
// sem linha na tabela users, para ninguém ficar trancado do lado de fora
// (ex: antes de cadastrar o primeiro usuário, ou se todos esquecerem a senha).
const EMERGENCY_USER = Object.freeze({
  id: null,
  name: "Admin (emergência)",
  email: null,
  role: "admin",
  emergency: true,
});

async function isEmergencyLogin(username, password) {
  return (
    Boolean(ADMIN_PASSWORD_HASH) &&
    typeof username === "string" &&
    username === ADMIN_USERNAME &&
    typeof password === "string" &&
    password.length > 0 &&
    (await bcrypt.compare(password, ADMIN_PASSWORD_HASH))
  );
}

router.get("/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/dashboard");
  res.send(buildLoginHTML());
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  const retryAfterMs = loginRetryAfterMs(req.ip, username);
  if (retryAfterMs > 0) {
    const minutes = Math.ceil(retryAfterMs / 60000);
    console.warn(`[Auth] Login bloqueado temporariamente para "${username}" (IP ${req.ip}) — muitas tentativas.`);
    res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    return res
      .status(429)
      .send(buildLoginHTML(`Muitas tentativas de login. Tente novamente em ${minutes} min.`));
  }

  let user = null;
  if (await isEmergencyLogin(username, password)) {
    user = EMERGENCY_USER;
    console.warn(`[Auth] Login com o ACESSO DE EMERGÊNCIA do .env (IP ${req.ip}).`);
  } else {
    try {
      const row = await verifyCredentials(username, password);
      if (row) user = sessionUser(row);
    } catch (error) {
      // Banco indisponível ou migração não aplicada: não conta como senha errada.
      return res
        .status(503)
        .send(buildLoginHTML("Não foi possível conferir o login agora. Tente novamente em instantes."));
    }
  }

  if (!user) {
    registerLoginFailure(req.ip, username);
    console.warn(`[Auth] Tentativa de login falhou para "${username}" (IP ${req.ip})`);
    return res.send(buildLoginHTML("E-mail ou senha incorretos."));
  }

  clearLoginFailures(req.ip, username);
  // Troca o id da sessão no login (evita fixação de sessão: um id plantado
  // antes do login não passa a valer como sessão autenticada).
  req.session.regenerate((err) => {
    if (err) {
      console.error("[Auth] Erro ao criar a sessão:", err.message);
      return res.status(500).send(buildLoginHTML("Erro ao entrar. Tente novamente."));
    }
    req.session.user = { ...user };
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("[Auth] Erro ao salvar a sessão:", saveErr.message);
        return res.status(500).send(buildLoginHTML("Erro ao entrar. Tente novamente."));
      }
      if (!user.emergency) console.log(`[Auth] ${user.name} (${user.role}) entrou no painel.`);
      res.redirect("/dashboard");
    });
  });
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
      background: var(--bg-app);
    }
    .login-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg);
      padding: 32px; width: 100%; max-width: 380px; box-shadow: var(--shadow-md);
    }
    .login-logo { display: block; height: 26px; width: auto; margin-bottom: 24px; }
    .subtitle { color: var(--text-secondary); font-size: 0.86rem; margin-bottom: 24px; }
    label { display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
    input {
      width: 100%; height: 38px; padding: 0 12px; margin-bottom: 16px; background: var(--bg-app);
      border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary);
      font-size: 0.88rem; font-family: inherit; transition: border-color 0.12s, box-shadow 0.12s;
    }
    input:hover { border-color: var(--border-strong); }
    input:focus { outline: none; border-color: var(--brand-gold); box-shadow: 0 0 0 3px var(--brand-gold-soft); }
    button {
      width: 100%; height: 38px; margin-top: 4px; background: var(--brand-gold); color: #17110a; border: none;
      border-radius: var(--radius-sm); font-size: 0.86rem; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: filter 0.12s;
    }
    button:hover { filter: brightness(1.08); }
    .error-msg {
      background: rgba(242,85,90,0.08); border: 1px solid rgba(242,85,90,0.3); color: #f77c80;
      padding: 9px 12px; border-radius: var(--radius-sm); font-size: 0.82rem; margin-bottom: 16px;
    }
  </style>
</head>
<body class="dashboard-body">
  <div class="login-card">
    <img class="login-logo" src="/img/logo-white.png" alt="Miguel Arcanjo Advocacia" />
    <div class="subtitle">Acesso restrito ao painel</div>
    ${error ? `<div class="error-msg">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="/login">
      <label for="username">E-mail</label>
      <input type="text" id="username" name="username" autocomplete="username" inputmode="email" required autofocus />
      <label for="password">Senha</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>`;
}

export default router;
