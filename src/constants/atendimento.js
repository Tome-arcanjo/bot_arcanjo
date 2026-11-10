// Colunas do quadro de Atendimento (um card por cliente do WhatsApp), na
// ordem em que aparecem. Independentes das colunas do CRM: aqui é a etapa do
// atendimento, não o andamento jurídico do caso. Fonte única: o servidor
// valida a etapa com esta lista e a tela a recebe pronta (ver atendimentoView).
//
// A primeira coluna é o DEFAULT de sessions.board_stage no init.sql — se
// trocar o nome dela, troque lá também.
export const ATENDIMENTO_COLUMNS = [
  "Aguardando atendimento",
  "Em atendimento",
  "Aguardando cliente",
  "Finalizado",
];

export const FIRST_STAGE = ATENDIMENTO_COLUMNS[0];
// Coluna para onde vai quem uma pessoa assume (ou recebe por transferência).
export const IN_PROGRESS_STAGE = "Em atendimento";
// Encerrar o atendimento leva para cá. Cliente que escreve de novo depois de
// finalizado volta para a primeira coluna.
export const FINISHED_STAGE = "Finalizado";

export function isValidStage(stage) {
  return ATENDIMENTO_COLUMNS.includes(stage);
}

/** Etapa da conversa; sessões antigas (ou sem a coluna) caem na primeira. */
export function stageOf(session) {
  return isValidStage(session?.board_stage) ? session.board_stage : FIRST_STAGE;
}

/** Campos de sessions que levam o card para `stage`, com autor (actor null = Sistema). */
export function stageFields(stage, actor, now = new Date().toISOString()) {
  return {
    board_stage: stage,
    board_stage_changed_by: actor?.id || null,
    board_stage_changed_by_name: actor?.name || "Sistema",
    board_stage_changed_at: now,
  };
}

/**
 * Ao assumir/receber a conversa, quem estava esperando ou encerrado passa a
 * "Em atendimento". Quem já foi movido pela equipe (ex: Aguardando cliente) fica.
 */
export function stageFieldsOnHandle(session, actor) {
  const stage = stageOf(session);
  return stage === FIRST_STAGE || stage === FINISHED_STAGE ? stageFields(IN_PROGRESS_STAGE, actor) : {};
}
