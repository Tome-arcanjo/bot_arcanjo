import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import chatRoutes from "./routes/chat.js";
import whatsappRoutes from "./routes/whatsapp.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import crmRoutes from "./routes/crmRoutes.js";
import { initDatabase } from "./database/db.js";
import { loadSettingsFromDb } from "./services/settingsService.js";
import { adminDashboard } from "./controllers/adminController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// â”€â”€ Middlewares â”€â”€
app.use(cors());
// Guarda o corpo bruto da requisiÃ§Ã£o (necessÃ¡rio para validar a assinatura
// X-Hub-Signature-256 enviada pela Meta no webhook do WhatsApp).
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

// Log de requisiÃ§Ãµes (simplificado para produÃ§Ã£o)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    if (req.path !== "/favicon.ico") {
      console.log(`[${NODE_ENV}] ${req.method} ${req.path} â†’ ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// â”€â”€ Rotas da API â”€â”€
app.use("/api/chat", chatRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/crm", crmRoutes);
app.use("/webhook/whatsapp", whatsappRoutes);

// â”€â”€ Admin Dashboard â”€â”€
app.get("/admin", adminDashboard);

// â”€â”€ Interface Web â”€â”€
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// â”€â”€ Handler de erros nÃ£o tratados â”€â”€
app.use((err, req, res, next) => {
  console.error("[Server Error]", err.message);
  res.status(500).json({ success: false, error: "Erro interno do servidor." });
});

// â”€â”€ Boot â”€â”€
async function start() {
  await initDatabase();
  await loadSettingsFromDb();

  app.listen(PORT, "0.0.0.0", () => {
    console.log("=".repeat(50));
    console.log(`  âš¡ Bot Arcanjo`);
    console.log(`  Ambiente : ${NODE_ENV}`);
    console.log(`  Porta    : ${PORT}`);
    console.log(`  Web      : http://localhost:${PORT}`);
    console.log(`  Admin    : http://localhost:${PORT}/admin`);
    console.log(`  Webhook  : http://localhost:${PORT}/webhook/whatsapp`);
    console.log("=".repeat(50));
  });
}

start();

