// Etiquetas jurídicas que a equipe anexa ao cliente (clients.tags guarda os
// ids). Fonte única: o servidor valida com esta lista e o layout a injeta em
// window.Dash.tags. Para criar/renomear, mude só aqui — o id não deve mudar
// depois de usado (é o que fica gravado no banco).
// color: uma das classes .badge-* de public/css/brand.css.
export const CLIENT_TAGS = [
  { id: "aguardando-documentacao", label: "Aguardando documentação", color: "orange" },
  { id: "documentacao-completa", label: "Documentação completa", color: "green" },
  { id: "procuracao-assinada", label: "Procuração assinada", color: "green" },
  { id: "contrato-assinado", label: "Contrato de honorários assinado", color: "green" },
  { id: "audiencia-agendada", label: "Audiência agendada", color: "blue" },
  { id: "audiencia-cancelada", label: "Audiência cancelada", color: "red" },
  { id: "audiencia-realizada", label: "Audiência realizada", color: "gray" },
  { id: "aguardando-pericia", label: "Aguardando perícia", color: "orange" },
  { id: "aguardando-calculos", label: "Aguardando cálculos", color: "orange" },
  { id: "prazo-em-curso", label: "Prazo em curso", color: "red" },
  { id: "proposta-de-acordo", label: "Proposta de acordo", color: "gold" },
  { id: "acordo-fechado", label: "Acordo fechado", color: "green" },
  { id: "sentenca-publicada", label: "Sentença publicada", color: "blue" },
  { id: "recurso-em-andamento", label: "Recurso em andamento", color: "blue" },
  { id: "prioridade-legal", label: "Prioridade legal", color: "red" },
  { id: "retornar-contato", label: "Retornar contato", color: "gold" },
  { id: "sem-interesse", label: "Sem interesse", color: "gray" },
];

const TAG_IDS = new Set(CLIENT_TAGS.map((t) => t.id));

export function isValidTag(id) {
  return TAG_IDS.has(id);
}
