import "dotenv/config";
import crypto from "crypto";
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import whatsappRoutes from "./routes/whatsapp.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import crmRoutes from "./routes/crmRoutes.js";
import contatosRoutes from "./routes/contatosRoutes.js";
import conversasRoutes from "./routes/conversasRoutes.js";
import authRoutes from "./routes/auth.js";
import { usersRouter, meRouter } from "./routes/usersRoutes.js";
import { requireAuth, requireAdmin } from "./middleware/auth.js";
import { sessionStore } from "./services/sessionStore.js";
import { initDatabase } from "./database/db.js";
import { loadSettingsFromDb } from "./services/settingsService.js";
import { startCallReminderScheduler } from "./services/callService.js";
import {
  dashboardRoot,
  configuracoesView,
  canaisView,
  crmView,
  conversasView,
  contatosView,
  usuariosView,
} from "./controllers/dashboardController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// ── Segredo da sessão ──
// Em produção é obrigatório: sem ele qualquer um que conheça o valor padrão
// conseguiria forjar um cookie de login. Em desenvolvimento geramos um
// aleatório (as sessões caem a cada reinício, o que não importa localmente).
const LEGACY_DEFAULT_SECRET = "troque-este-segredo-no-env";
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === LEGACY_DEFAULT_SECRET) {
  if (IS_PRODUCTION) {
    console.error("[Server] SESSION_SECRET não configurado no .env — o servidor não sobe em produção sem ele.");
    console.error("[Server] Gere um com: openssl rand -hex 32");
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("[Server] SESSION_SECRET não configurado — usando um segredo temporário (as sessões caem a cada reinício).");
}

// ── Proxy reverso (Nginx, e eventualmente Cloudflare na frente dele) ──
// "trust proxy" diz ao Express em quantos saltos de proxy confiar para ler
// X-Forwarded-Proto/X-Forwarded-For. Sem isso ele não sabe que a conexão
// original era HTTPS. Aceita número de saltos, true/false ou os nomes do
// Express (ex: "loopback").
function parseTrustProxy(value) {
  if (value === undefined || value === "") return 1;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

// ── Cookie "secure" ──
//  - "auto" (padrão): marca o cookie como Secure só quando o Express enxerga a
//    requisição como HTTPS. Se o proxy informar "http" (ex: Cloudflare em modo
//    "Flexible" ou Nginx sem X-Forwarded-Proto), o login ainda funciona — antes
//    ele entrava em loop porque o navegador nunca recebia o cookie.
//  - "true": sempre Secure (recomendado depois de corrigir o proxy).
//  - "false": nunca Secure (só para testes locais sem HTTPS).
function parseCookieSecure(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return "auto";
}
const COOKIE_SECURE = parseCookieSecure(process.env.COOKIE_SECURE);

// Em produção avisa (no máximo 1x a cada 10 min) quando uma requisição chega
// como HTTP: é o sintoma de proxy mal configurado que causava o loop de login.
const HTTP_WARNING_INTERVAL_MS = 10 * 60 * 1000;
let lastHttpWarningAt = 0;
function warnIfProxyNotHttps(req, res, next) {
  if (IS_PRODUCTION && !req.secure && Date.now() - lastHttpWarningAt > HTTP_WARNING_INTERVAL_MS) {
    lastHttpWarningAt = Date.now();
    console.warn(
      `[Server] Requisição chegou como HTTP em produção (X-Forwarded-Proto="${req.get("x-forwarded-proto") || ""}"). ` +
        `Confira se o Nginx envia "proxy_set_header X-Forwarded-Proto $scheme" (ou o valor recebido do Cloudflare) ` +
        `e se o Cloudflare está em SSL "Full (strict)". ` +
        (COOKIE_SECURE === true
          ? "Com COOKIE_SECURE=true o cookie de login NÃO é gravado nessas requisições."
          : "O cookie de login está sendo gravado sem a flag Secure.")
    );
  }
  next();
}

// ── Middlewares ──
app.use(warnIfProxyNotHttps);
// Guarda o corpo bruto da requisição (necessário para validar a assinatura
// X-Hub-Signature-256 enviada pela Meta no webhook do WhatsApp).
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos (css/js/imagens) precisam ficar acessíveis ANTES do
// bloqueio de autenticação: a própria tela de login depende de
// /css/brand.css e /img/logo-white.png para renderizar, e eles não têm
// nenhum dado sensível — não há problema em servi-los sem login. Ficam antes
// da sessão também, para não consultar o store de sessão a cada arquivo.
app.use(express.static(path.join(__dirname, "../public")));

app.use(
  session({
    // Sessões gravadas no Supabase (web_sessions): sobrevivem a reinícios e
    // podem ser derrubadas por usuário (ver services/sessionStore.js).
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: COOKIE_SECURE,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    },
  })
);

// Rotas de login/logout — precisam ficar acessíveis ANTES do bloqueio de
// autenticação abaixo, senão ninguém conseguiria nem chegar à tela de login.
app.use(authRoutes);

// A partir daqui, tudo exige login — exceto o webhook do WhatsApp (ver
// src/middleware/auth.js), que é protegido separadamente pela validação de
// assinatura da Meta.
app.use(requireAuth);

// Log de requisições (simplificado para produção)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    if (req.path !== "/favicon.ico") {
      console.log(`[${NODE_ENV}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// ── Rotas da API ──
app.use("/api/me", meRouter);
app.use("/api/users", usersRouter); // somente admin (requireAdmin dentro do router)
app.use("/api/settings", settingsRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/contatos", contatosRoutes);
app.use("/api/conversas", conversasRoutes);
app.use("/webhook/whatsapp", whatsappRoutes);

// ── Painel (dashboard pós-login) ──
// /admin é mantido como redirecionamento (compatibilidade com links antigos)
// — a versão atual dessa tela agora vive em /dashboard/canais.
app.get("/admin", (req, res) => res.redirect("/dashboard/canais"));
app.get("/dashboard", dashboardRoot);
app.get("/dashboard/configuracoes", requireAdmin, configuracoesView); // personalidade do bot: só admin
app.get("/dashboard/crm", crmView);
app.get("/dashboard/conversas", conversasView);
app.get("/dashboard/contatos", contatosView);
app.get("/dashboard/canais", canaisView);
app.get("/dashboard/usuarios", requireAdmin, usuariosView);

// ── Landing (raiz do domínio) ──
// A raiz do site agora vai direto pro painel — a antiga interface de chat de
// teste (public/index.html) foi removida junto com o restante das rotas
// mortas da primeira versão do projeto (ver /admin logo acima, que também só
// existe como redirecionamento de compatibilidade).
app.get("/", (req, res) => res.redirect("/dashboard"));

// ── Handler de erros não tratados ──
app.use((err, req, res, next) => {
  console.error("[Server Error]", err.message);
  res.status(500).json({ success: false, error: "Erro interno do servidor." });
});

// ── Boot ──
async function start() {
  await initDatabase();
  await loadSettingsFromDb();

  app.listen(PORT, "0.0.0.0", () => {
    console.log("=".repeat(50));
    console.log(`  ⚡ Bot Arcanjo`);
    console.log(`  Ambiente : ${NODE_ENV}`);
    console.log(`  Porta    : ${PORT}`);
    console.log(`  Painel   : http://localhost:${PORT}/dashboard`);
    console.log(`  Webhook  : http://localhost:${PORT}/webhook/whatsapp`);
    console.log("=".repeat(50));

    if (!process.env.ADMIN_PASSWORD_HASH) {
      console.warn("[Auth] ADMIN_PASSWORD_HASH não configurado — não há acesso de emergência (só login pela tabela users).");
    }
    if (!process.env.WHATSAPP_APP_SECRET) {
      console.warn("[WhatsApp] WHATSAPP_APP_SECRET não configurado — o webhook vai RECUSAR todas as mensagens da Meta.");
    }

    // Avisos de "ligação atrasada" (ver services/callService.js).
    startCallReminderScheduler();
  });
}

start();
