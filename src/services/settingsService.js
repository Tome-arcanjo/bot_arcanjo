import { getDb } from "../database/db.js";
import "dotenv/config";

// Cache em memória para não precisar ir ao banco a cada mensagem
let cachedSettings = {
  systemPrompt: process.env.SYSTEM_PROMPT || "Você é o Arcanjo, um assistente inteligente, prestativo e amigável. Responda sempre em português.",
};

// Buscar as configurações no banco de dados e atualizar o cache
export async function loadSettingsFromDb() {
  const supabase = getDb();
  if (!supabase) return cachedSettings;

  const { data, error } = await supabase
    .from("bot_settings")
    .select("system_prompt")
    .eq("id", "global")
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = 0 rows returned
    console.error("[Settings] Erro ao buscar configurações no Supabase:", error.message);
  } else if (data) {
    cachedSettings.systemPrompt = data.system_prompt;
    console.log("[Settings] Configurações carregadas do banco de dados.");
  }
  
  return cachedSettings;
}

// Retorna as configurações em cache atual
export function getSettings() {
  return cachedSettings;
}

// Atualizar as configurações e refletir no banco de dados
export async function updateSettings(newPrompt) {
  const supabase = getDb();
  
  // Atualiza cache imediatamente
  cachedSettings.systemPrompt = newPrompt;

  if (supabase) {
    const { error } = await supabase
      .from("bot_settings")
      .upsert({ id: "global", system_prompt: newPrompt, updated_at: new Date() });

    if (error) {
      console.error("[Settings] Erro ao salvar configurações no Supabase:", error.message);
      throw error;
    }
    console.log("[Settings] Configurações atualizadas no banco de dados.");
  }

  return cachedSettings;
}
