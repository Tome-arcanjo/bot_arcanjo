// Hook de resolução de módulos do Node: troca dependências externas por fakes
// durante os testes. Ativado por "--import ./test/support/register.mjs".
const FAKES = {
  "@supabase/supabase-js": new URL("../fakes/supabase.js", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (FAKES[specifier]) return { url: FAKES[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
