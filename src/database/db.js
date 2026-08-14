import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "[DB] SUPABASE_URL e SUPABASE_KEY são obrigatórios no .env"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export function getDb() {
  return supabase;
}

// As tabelas já devem existir no Supabase (criadas via SQL Editor).
// Esta função existe apenas para manter compatibilidade com server.js.
export function initDatabase() {
  console.log("[DB] Conectado ao Supabase com sucesso.");
}
