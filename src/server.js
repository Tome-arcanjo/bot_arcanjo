import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import whatsappRoutes from "./routes/whatsapp.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import crmRoutes from "./routes/crmRoutes.js";
import contatosRoutes from "./routes/contatosRoutes.js";
import conversasRoutes from "./routes/conversasRoutes.js";
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { initDatabase } from "./database/db.js";
import { loadSettingsFromDb } from "./services/settingsService.js";
import {
  dashboardRoot,
  configuracoesView,
  canaisView,
  crmView,
  conversasView,
  contatosView,
} from "./controllers/dashboardController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Necessário atrás do proxy reverso do Nginx: sem isso, o Express não sabe
// que a conexão original era HTTPS, e os cookies "secure" nunca são aceitos.
app.set("trust proxy", 1);

// ── Middlewares ──
app.use(cors());
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

app.use(
  session({
    secret: process.env.SESSION_SECRET || "troque-este-segredo-no-env",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    },
  })
);

// Rotas de login/logout — precisam ficar acessíveis ANTES do bloqueio de
// autenticação abaixo, senão ninguém conseguiria nem chegar à tela de login.
app.use(authRoutes);

// Arquivos estáticos (css/js/imagens) também precisam ficar acessíveis ANTES
// do bloqueio de autenticação: a própria tela de login depende de
// /css/brand.css e /img/logo-white.png para renderizar, e eles não têm
// nenhum dado sensível — não há problema em servi-los sem login.
app.use(express.static(path.join(__dirname, "../public")));

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
app.get("/dashboard/configuracoes", configuracoesView);
app.get("/dashboard/crm", crmView);
app.get("/dashboard/conversas", conversasView);
app.get("/dashboard/contatos", contatosView);
app.get("/dashboard/canais", canaisView);

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
    console.log(`  Web      : http://localhost:${PORT}`);
    console.log(`  Admin    : http://localhost:${PORT}/admin`);
    console.log(`  Webhook  : http://localhost:${PORT}/webhook/whatsapp`);
    console.log("=".repeat(50));
  });
}

start();
