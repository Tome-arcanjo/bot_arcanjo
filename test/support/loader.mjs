// Hook de resolução de módulos do Node: troca dependências externas por fakes
// durante os testes. Ativado por "--import ./test/support/register.mjs".
const FAKES = {
  "@supabase/supabase-js": new URL("../fakes/supabase.js", import.meta.url).href,
};

// Módulos do próprio app trocados pelo caminho resolvido (os provedores de IA
// são importados com caminho relativo).
const FAKE_AI = new URL("../fakes/ai.js", import.meta.url).href;
const LOCAL_FAKES = [/\/src\/providers\/anthropic\.js$/, /\/src\/providers\/openai\.js$/];

export async function resolve(specifier, context, nextResolve) {
  if (FAKES[specifier]) return { url: FAKES[specifier], shortCircuit: true };
  const resolved = await nextResolve(specifier, context);
  if (LOCAL_FAKES.some((re) => re.test(resolved.url))) return { url: FAKE_AI, shortCircuit: true };
  return resolved;
}
