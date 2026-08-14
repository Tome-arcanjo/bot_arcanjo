import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQL_PATH = path.join(__dirname, "../../init.sql");

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Roda o init.sql contra o banco.
 *
 * O cliente @supabase/supabase-js (usado no resto do app) não executa SQL
 * arbitrário/DDL — ele só fala a REST API de tabelas já existentes. Por isso
 * esse script usa uma conexão Postgres direta (DATABASE_URL, disponível em
 * Supabase > Project Settings > Database > Connection string > URI).
 *
 * Se DATABASE_URL não estiver configurada, apenas mostra o que precisa ser
 * rodado manualmente no SQL Editor do Supabase.
 */
async function migrate() {
  const sql = fs.readFileSync(SQL_PATH, "utf-8");

  if (!DATABASE_URL) {
    console.log("=".repeat(60));
    console.log("[DB Migrate] DATABASE_URL não configurada no .env.");
    console.log("Rode o SQL abaixo manualmente no Supabase Dashboard > SQL Editor:");
    console.log(`  ${SQL_PATH}`);
    console.log("=".repeat(60));
    return;
  }

  // Import dinâmico: só exige o pacote "pg" instalado se for realmente usado.
  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    console.error(
      '[DB Migrate] O pacote "pg" não está instalado. Rode: npm install pg'
    );
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log("[DB Migrate] Conectado ao Postgres. Aplicando init.sql...");
    await client.query(sql);
    console.log("[DB Migrate] Migração aplicada com sucesso ✅");
  } catch (error) {
    console.error("[DB Migrate] Erro ao aplicar migração:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrate();
