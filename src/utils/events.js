import { EventEmitter } from "events";

// Cria e exporta um emissor de eventos global (singleton)
// Será usado para comunicação entre o chatService (que salva mensagens)
// e o conversasRoutes (que serve SSE para o painel).
const eventBus = new EventEmitter();

export default eventBus;
