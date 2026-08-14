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

// As tabelas já devem existir no Supabase (criadas via SQL Editor ou
// "npm run db:migrate"). Aqui fazemos uma checagem leve de conectividade no
// boot para falhar cedo e com uma mensagem clara, em vez de só descobrir
// que as credenciais estão erradas na primeira requisição de um usuário.
export async function initDatabase() {
  const { error } = await supabase.from("sessions").select("id", { count: "exact", head: true });

  if (error) {
    console.error("[DB] Não foi possível conectar ao Supabase:", error.message);
    console.error("[DB] Verifique SUPABASE_URL/SUPABASE_KEY e se as tabelas foram criadas (init.sql).");
    return;
  }

  console.log("[DB] Conectado ao Supabase com sucesso.");
}
