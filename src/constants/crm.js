// Colunas (status) do Kanban do CRM, na ordem em que aparecem no quadro.
// Fonte única: o servidor valida o status com esta lista e a tela do CRM a
// recebe pronta (ver crmView em dashboardController.js).
export const CRM_COLUMNS = [
  "Novo caso",
  "Em análise",
  "Documentos pendentes",
  "Processo iniciado",
  "Petição em elaboração",
  "Petição protocolada",
  "Aguardando manifestação",
  "Aguardando audiência",
  "Aguardando decisão",
  "Recurso",
  "Finalizado",
  "Arquivado",
];

export function isValidStatus(status) {
  return CRM_COLUMNS.includes(status);
}

// Autores "de sistema" do histórico (sem usuário): a IA só cria casos e
// classifica urgência/área — nunca move nem atribui.
export const AI_ACTOR = Object.freeze({ id: null, name: "IA (classificação)" });
export const SYSTEM_ACTOR = Object.freeze({ id: null, name: "Sistema" });
