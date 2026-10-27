import { EventEmitter } from "events";

// Cria e exporta um emissor de eventos global (singleton)
// Será usado para comunicação entre o chatService (que salva mensagens)
// e o conversasRoutes (que serve SSE para o painel).
const eventBus = new EventEmitter();

// Cada aba do painel aberta mantém uma conexão SSE, e cada conexão registra
// seus listeners aqui. Com vários funcionários e várias abas, o limite padrão
// do Node (10) dispara o aviso de "possible memory leak" sem haver vazamento.
// 100 cobre a equipe com folga e ainda denuncia um vazamento de verdade.
eventBus.setMaxListeners(100);

export default eventBus;
