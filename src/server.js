import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import chatRoutes from "./routes/chat.js";
import whatsappRoutes from "./routes/whatsapp.js";
import { initDatabase } from "./database/db.js";
import { adminDashboard } from "./controllers/adminController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ── Middlewares ──
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

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
app.use("/api/chat", chatRoutes);
app.use("/webhook/whatsapp", whatsappRoutes);

// ── Admin Dashboard ──
app.get("/admin", adminDashboard);

// ── Interface Web ──
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ── Handler de erros não tratados ──
app.use((err, req, res, next) => {
  console.error("[Server Error]", err.message);
  res.status(500).json({ success: false, error: "Erro interno do servidor." });
});

// ── Boot ──
initDatabase();
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
