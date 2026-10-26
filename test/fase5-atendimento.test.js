import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { startServer, makeClient, until } from "./support/server.js";
import { sseReader } from "./support/sse.js";
import { webhook, startFakeGraph, APP_SECRET } from "./support/whatsapp.js";
import { launchBrowser, findChrome } from "./support/browser.js";
import { TEAM, EMERGENCY_ENV, teamRows, loginAs } from "./support/seed.js";

const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "arcanjo-screens");
const noBrowser = findChrome() ? false : "nenhum Chrome/Edge encontrado (CHROME_PATH)";
const HOURS = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// Conversa antiga: última mensagem do cliente há 25 h (janela fechada).
const OLD_PHONE = "5511911110000";
function oldConversation() {
  return {
    sessions: [{ id: "s-old", title: "Cliente antigo", provider: "anthropic", phone: OLD_PHONE, ai_paused: false, created_at: ago(30 * HOURS), updated_at: ago(25 * HOURS) }],
    messages: [
      { id: "m-old-1", session_id: "s-old", role: "user", content: "Preciso de ajuda", created_at: ago(25 * HOURS) },
      { id: "m-old-2", session_id: "s-old", role: "assistant", content: "Claro!", created_at: ago(25 * HOURS - 60000) },
    ],
    crm_cases: [{ id: "c-old", phone: OLD_PHONE, client_name: "Cliente Antigo", status: "Em análise", urgency_tag: "Normal", updated_at: ago(HOURS), call_status: "pendente", call_scheduled_at: new Date(Date.now() + 2 * HOURS).toISOString(), call_reminders_sent: 0 }],
  };
}

const BASE_ENV = { ...EMERGENCY_ENV, WHATSAPP_APP_SECRET: APP_SECRET };

async function logged(server, who) {
  const client = makeClient(server.url);
  await loginAs(client, who);
  return client;
}

function messagesOf(server, phone) {
  const db = server.readDb();
  const session = (db.sessions || []).find((s) => s.phone === phone);
  if (!session) return [];
  return (db.messages || []).filter((m) => m.session_id === session.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

const sessionOf = (server, phone) => (server.readDb().sessions || []).find((s) => s.phone === phone);
const replies = (calls) => calls.filter((c) => c.kind === "reply");

describe("atendimento humano (modo simulado)", () => {
  const PHONE = "5511955555555";
  let server;
  let wa;
  let ana;
  let bia;
  let anaStream;
  let biaStream;

  before(async () => {
    server = await startServer({ env: { ...BASE_ENV, WHATSAPP_SIMULATE: "true" }, db: { users: teamRows(), ...oldConversation() } });
    wa = webhook(server);
    ana = await logged(server, TEAM.ana);
    bia = await logged(server, TEAM.bia);
    anaStream = sseReader(await ana.request("/api/conversas/stream"));
    biaStream = sseReader(await bia.request("/api/conversas/stream"));
  });
  after(async () => {
    anaStream.close();
    biaStream.close();
    await server.stop();
  });

  test("com a IA ativa: salva, classifica, responde e marca a entrega", async () => {
    await wa.text(PHONE, "Oi, fui demitido e não recebi as verbas");
    const reply = await until(() => messagesOf(server, PHONE).find((m) => m.role === "assistant" && m.delivery_status === "sent"), { what: "a resposta da IA" });
    assert.equal(reply.content, "Resposta da IA para: Oi, fui demitido e não recebi as verbas");
    assert.match(reply.wa_message_id, /^sim-/);

    // o classificador (IA) criou o caso — mas na coluna padrão e sem responsável
    const crmCase = await until(() => server.readDb().crm_cases.find((c) => c.phone === PHONE), { what: "o caso no CRM" });
    assert.equal(crmCase.status, "Novo caso");
    assert.equal(crmCase.assigned_to, undefined);
    assert.ok(server.readDb().case_events.some((e) => e.case_id === crmCase.id && e.type === "created" && e.actor_name === "IA (classificação)"));

    // o painel recebeu a mensagem do cliente, a da IA e o status da entrega
    await anaStream.waitFor((e) => e.event === "message" && e.data.message.role === "user" && e.data.session.phone === PHONE);
    await anaStream.waitFor((e) => e.event === "message" && e.data.message.id === reply.id);
    await anaStream.waitFor((e) => e.event === "status" && e.data.messageId === reply.id && e.data.status === "sent");
  });

  test("assumir pausa a IA: a mensagem do cliente é salva e classificada, mas a IA não responde", async () => {
    const session = sessionOf(server, PHONE);
    const res = await ana.request(`/api/conversas/${session.id}/assume`, { method: "POST", json: {} });
    assert.equal(res.status, 200);
    const updated = (await res.json()).data;
    assert.equal(updated.ai_paused, true);
    assert.equal(updated.handler_user_id, TEAM.ana.id);
    await biaStream.waitFor((e) => e.event === "session" && e.data.session.id === session.id && e.data.session.ai_paused === true);
    assert.ok(server.readDb().case_events.some((e) => e.session_id === session.id && e.type === "ai_paused" && e.user_id === TEAM.ana.id));

    const repliesBefore = replies(server.aiCalls()).length;
    await wa.text(PHONE, "Fui demitido ontem, ainda está aí?");
    await until(() => messagesOf(server, PHONE).find((m) => m.content === "Fui demitido ontem, ainda está aí?"), { what: "a mensagem do cliente" });
    await until(() => server.aiCalls().some((c) => c.kind === "classifier" && c.messages[0].content.includes("ainda está aí")), { what: "a classificação" });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(replies(server.aiCalls()).length, repliesBefore, "a IA não pode ser chamada para responder");
    assert.equal(messagesOf(server, PHONE).at(-1).role, "user");
    assert.match(server.logs(), /IA pausada para 5511955555555/);
  });

  test("funcionário responde; outro precisa confirmar para passar por cima", async () => {
    const session = sessionOf(server, PHONE);
    let res = await ana.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "Olá, aqui é a Ana do escritório." } });
    assert.equal(res.status, 200);
    const sent = (await res.json()).data;
    assert.equal(sent.role, "human");
    assert.equal(sent.sender_user_id, TEAM.ana.id);
    assert.equal(sent.delivery_status, "sent");

    res = await bia.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "Oi, é a Bia" } });
    assert.equal(res.status, 409);
    const conflict = await res.json();
    assert.equal(conflict.code, "HANDLED_BY_OTHER");
    assert.equal(conflict.handler.name, "Ana Souza");
    assert.equal(messagesOf(server, PHONE).filter((m) => m.content === "Oi, é a Bia").length, 0);

    res = await bia.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "Oi, é a Bia", force: true } });
    assert.equal(res.status, 200);
    assert.equal(sessionOf(server, PHONE).handler_user_id, TEAM.bia.id);

    // mensagem vazia e longa demais
    assert.equal((await bia.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "   " } })).status, 400);
    assert.equal((await bia.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "x".repeat(5000) } })).status, 400);
  });

  test("devolver à IA: ela volta a responder e recebe as mensagens humanas como 'assistant'", async () => {
    const session = sessionOf(server, PHONE);
    const res = await bia.request(`/api/conversas/${session.id}/release`, { method: "POST" });
    assert.equal((await res.json()).data.ai_paused, false);
    assert.ok(server.readDb().case_events.some((e) => e.session_id === session.id && e.type === "ai_resumed"));

    await wa.text(PHONE, "E agora, o que eu faço?");
    await until(() => messagesOf(server, PHONE).find((m) => m.content === "Resposta da IA para: E agora, o que eu faço?"), { what: "a resposta da IA" });

    const call = replies(server.aiCalls()).at(-1);
    const roles = call.messages.map((m) => m.role);
    assert.ok(roles.every((r) => r === "user" || r === "assistant"), `papéis inválidos: ${roles}`);
    assert.equal(roles[0], "user");
    for (let i = 1; i < roles.length; i++) assert.notEqual(roles[i], roles[i - 1], "turnos seguidos do mesmo papel são unidos");
    const assistantText = call.messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
    assert.match(assistantText, /Olá, aqui é a Ana do escritório\./);
    assert.match(assistantText, /Oi, é a Bia/);
  });

  test("presença: quem está com a conversa aberta aparece para os outros", async () => {
    const session = sessionOf(server, PHONE);
    await ana.request(`/api/conversas/${session.id}/presence`, { method: "POST", json: {} });
    const ev = await biaStream.waitFor((e) => e.event === "presence" && e.data.sessionId === session.id && e.data.viewers.length === 1);
    assert.deepEqual(ev.data.viewers, [{ id: TEAM.ana.id, name: "Ana Souza" }]);
    await ana.request(`/api/conversas/${session.id}/presence`, { method: "POST", json: { leave: true } });
    await biaStream.waitFor((e) => e.event === "presence" && e.data.sessionId === session.id && e.data.viewers.length === 0);
  });

  test("fora da janela de 24 h: texto livre é recusado e o painel recebe o motivo", async () => {
    const res = await ana.request("/api/conversas/s-old/messages", { method: "POST", json: { content: "Oi, sumido!" } });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "WINDOW_CLOSED");
    assert.equal(body.window.open, false);
    assert.equal(body.window.templateConfigured, false);
    assert.equal(messagesOf(server, OLD_PHONE).length, 2, "nada é gravado");

    const state = await (await ana.request("/api/conversas/s-old/state")).json();
    assert.equal(state.data.window.open, false);
    assert.equal(state.data.sending, "simulated");

    const tpl = await ana.request("/api/conversas/s-old/template", { method: "POST", json: {} });
    assert.equal(tpl.status, 409);
    assert.match((await tpl.json()).error, /Nenhum modelo de retomada configurado/);
  });

  test("aviso automático (ligação remarcada) fora da janela fica registrado como não enviado", async () => {
    const when = new Date(Date.now() + 5 * HOURS).toISOString();
    const res = await ana.request("/api/crm/cases/c-old/call", { method: "PUT", json: { scheduledAt: when } });
    const body = await res.json();
    assert.equal(body.rescheduled, true);
    assert.equal(body.clientNotified, false);
    const notice = messagesOf(server, OLD_PHONE).at(-1);
    assert.equal(notice.role, "assistant");
    assert.equal(notice.delivery_status, "failed");
    assert.match(notice.delivery_error, /Fora da janela de 24 h/);
  });

  test("mídia não suportada fica registrada na conversa e a IA avisa o cliente", async () => {
    const phone = "5511966666666";
    await wa.text(phone, null, { type: "image" });
    const msgs = await until(() => {
      const m = messagesOf(server, phone);
      return m.length === 2 && m;
    }, { what: "o aviso e a resposta" });
    assert.match(msgs[0].content, /\[O cliente enviou uma imagem/);
    assert.match(msgs[1].content, /ainda não consigo processar uma imagem/);
    assert.ok(!server.aiCalls().some((c) => c.messages.some((m) => /O cliente enviou uma imagem/.test(m.content)) && c.kind === "classifier"));
  });

  test("erro na IA: o cliente recebe a mensagem de desculpas (registrada)", async () => {
    const phone = "5511977777777";
    await wa.text(phone, "erro-na-ia por favor");
    const reply = await until(() => messagesOf(server, phone).find((m) => m.role === "assistant"), { what: "a mensagem de desculpas" });
    assert.match(reply.content, /tive um problema para processar sua mensagem/);
  });
});

test("corrida: atendente assume enquanto a IA gera a resposta — a resposta é descartada", async () => {
  const server = await startServer({
    env: { ...BASE_ENV, WHATSAPP_SIMULATE: "true", FAKE_AI_DELAY_MS: "1200" },
    db: { users: teamRows() },
  });
  try {
    const PHONE = "5511988888888";
    const ana = await logged(server, TEAM.ana);
    await webhook(server).text(PHONE, "Olá, preciso de ajuda");
    const session = await until(() => sessionOf(server, PHONE), { what: "a conversa" });
    await until(() => messagesOf(server, PHONE).length === 1, { what: "a mensagem do cliente" });
    await ana.request(`/api/conversas/${session.id}/assume`, { method: "POST", json: {} });
    await until(() => /resposta da IA descartada/.test(server.logs()), { timeoutMs: 6000, what: "o descarte" });
    assert.equal(messagesOf(server, PHONE).filter((m) => m.role === "assistant").length, 0);
  } finally {
    await server.stop();
  }
});

test("envio desligado (sem simulação): a mensagem fica salva como não enviada, com o motivo", async () => {
  const server = await startServer({ env: { ...BASE_ENV }, db: { users: teamRows() } });
  try {
    const PHONE = "5511933334444";
    const ana = await logged(server, TEAM.ana);
    await webhook(server).text(PHONE, "Bom dia");
    const aiReply = await until(() => messagesOf(server, PHONE).find((m) => m.role === "assistant" && m.delivery_status === "failed"), { what: "a resposta não enviada" });
    assert.match(aiReply.delivery_error, /WHATSAPP_SEND_ENABLED=false/);

    const session = sessionOf(server, PHONE);
    const res = await ana.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "Oi, é a Ana" } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.delivered, false);
    assert.equal(body.data.delivery_status, "failed");

    const retry = await ana.request(`/api/conversas/messages/${body.data.id}/retry`, { method: "POST" });
    assert.equal((await retry.json()).data.delivery_status, "failed");
    const state = await (await ana.request(`/api/conversas/${session.id}/state`)).json();
    assert.equal(state.data.sending, "off");
  } finally {
    await server.stop();
  }
});

describe("envio real pela Cloud API (Graph falsa)", () => {
  const PHONE = "5511944444444";
  const BLOCKED = "5511900000000";
  let graph;
  let server;
  let wa;
  let ana;

  before(async () => {
    graph = await startFakeGraph({
      failFor: { [BLOCKED]: { code: 131030, message: "Recipient phone number not in allowed list", type: "OAuthException" } },
    });
    server = await startServer({
      env: {
        ...BASE_ENV,
        WHATSAPP_SEND_ENABLED: "true",
        WHATSAPP_TOKEN: "token-de-teste",
        WHATSAPP_PHONE_NUMBER_ID: "123456",
        WHATSAPP_GRAPH_URL: graph.url,
        WHATSAPP_TEMPLATE_REENGAGE: "retomada_atendimento",
      },
      db: { users: teamRows(), ...oldConversation() },
    });
    wa = webhook(server);
    ana = await logged(server, TEAM.ana);
  });
  after(async () => {
    await server?.stop();
    await graph?.close();
  });

  test("a resposta da IA vai para a Meta e guarda o id da mensagem", async () => {
    await wa.text(PHONE, "Olá");
    const reply = await until(() => messagesOf(server, PHONE).find((m) => m.role === "assistant" && m.delivery_status === "sent"), { what: "o envio" });
    const send = graph.sends().find((r) => r.body.to === PHONE);
    assert.equal(send.url, "/v22.0/123456/messages");
    assert.equal(send.auth, "Bearer token-de-teste");
    assert.deepEqual(send.body.text, { body: reply.content });
    assert.match(reply.wa_message_id, /^wamid\.out\./);
    // e a mensagem recebida foi marcada como lida
    assert.ok(graph.requests.some((r) => r.body.status === "read"));
  });

  test("status da Meta: entregue → lida, sem regredir; falha posterior mostra o motivo em português", async () => {
    const reply = messagesOf(server, PHONE).find((m) => m.role === "assistant");
    await wa.status(reply.wa_message_id, "delivered");
    await until(() => messagesOf(server, PHONE).find((m) => m.id === reply.id).delivery_status === "delivered");
    await wa.status(reply.wa_message_id, "read");
    await until(() => messagesOf(server, PHONE).find((m) => m.id === reply.id).delivery_status === "read");
    await wa.status(reply.wa_message_id, "delivered");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(messagesOf(server, PHONE).find((m) => m.id === reply.id).delivery_status, "read");

    const res = await ana.request(`/api/conversas/${sessionOf(server, PHONE).id}/messages`, { method: "POST", json: { content: "Mensagem que vai falhar depois" } });
    const human = (await res.json()).data;
    await wa.status(human.wa_message_id, "failed", [{ code: 131047, title: "Re-engagement message" }]);
    const failed = await until(() => {
      const m = messagesOf(server, PHONE).find((x) => x.id === human.id);
      return m.delivery_status === "failed" && m;
    }, { what: "a falha" });
    assert.match(failed.delivery_error, /Fora da janela de 24 h/);
  });

  test("erro imediato da Meta fica na mensagem (número não autorizado)", async () => {
    await wa.text(BLOCKED, "Oi");
    const reply = await until(() => messagesOf(server, BLOCKED).find((m) => m.role === "assistant" && m.delivery_status === "failed"), { what: "a falha" });
    assert.match(reply.delivery_error, /Número não autorizado/);
  });

  test("fora das 24 h: o modelo de retomada é enviado e a conversa passa para quem enviou", async () => {
    const res = await ana.request("/api/conversas/s-old/template", { method: "POST", json: {} });
    assert.equal(res.status, 200);
    const msg = (await res.json()).data;
    assert.equal(msg.content, "[Modelo de mensagem: retomada_atendimento]");
    assert.equal(msg.role, "human");
    assert.equal(msg.delivery_status, "sent");
    const send = graph.sends().find((r) => r.body.type === "template");
    assert.equal(send.body.to, OLD_PHONE);
    assert.deepEqual(send.body.template, { name: "retomada_atendimento", language: { code: "pt_BR" } });
    const session = sessionOf(server, OLD_PHONE);
    assert.equal(session.ai_paused, true);
    assert.equal(session.handler_user_id, TEAM.ana.id);
  });
});

describe("Conversas no navegador (Ana e Bia ao mesmo tempo)", { skip: noBrowser }, () => {
  const PHONE = "5511955550000";
  let server;
  let browser;
  let anaPage;
  let biaPage;
  let wa;

  async function openConversas(who, query = "") {
    const client = await logged(server, who);
    const page = await browser.newPage(server.url);
    await page.login(client.jar.get("connect.sid"));
    await page.goto("/dashboard/conversas" + query);
    await page.waitFor(() => document.querySelectorAll(".conversa-item").length > 0);
    return page;
  }

  // Visível de verdade (estilo computado), não só a propriedade hidden.
  const visible = (page, id) => page.eval(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display !== "none"`);

  const openItem = (page, phone) =>
    page.eval(`[...document.querySelectorAll(".conversa-item")].find((b) => b.textContent.includes(${JSON.stringify(phone)})).click()`);

  before(async () => {
    server = await startServer({ env: { ...BASE_ENV, WHATSAPP_SIMULATE: "true" }, db: { users: teamRows(), ...oldConversation() } });
    wa = webhook(server);
    await wa.text(PHONE, "Oi, fui demitido sem receber as verbas");
    await until(() => messagesOf(server, PHONE).some((m) => m.role === "assistant"), { what: "a resposta da IA" });
    browser = await launchBrowser();
    // Bia chega pelo link do CRM, com o telefone formatado de outro jeito
    biaPage = await openConversas(TEAM.bia, "?phone=" + encodeURIComponent("+55 (11) 95555-0000"));
    anaPage = await openConversas(TEAM.ana);
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test("link do CRM abre a conversa certa e a Ana vê que a Bia está nela", async () => {
    await biaPage.waitFor(() => document.getElementById("threadStatus").textContent === "IA respondendo");
    assert.equal(await biaPage.eval(() => location.search), "");
    await openItem(anaPage, PHONE);
    await anaPage.waitFor(() => !document.getElementById("threadPresence").hidden);
    assert.match(await anaPage.eval(() => document.getElementById("threadPresence").textContent), /Bia Lima também está com esta conversa aberta/);
  });

  test("Ana responde pelo painel: a IA pausa e a Bia vê tudo na hora", async () => {
    await anaPage.eval(() => {
      const input = document.getElementById("composerInput");
      input.value = "Olá! Aqui é a Ana, vou cuidar do seu caso.";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await anaPage.waitFor(() => [...document.querySelectorAll(".thread-msg.human")].some((m) => /Você/.test(m.textContent) && /Enviada \(simulado\)/.test(m.textContent)));
    await anaPage.waitFor(() => document.getElementById("threadStatus").textContent === "Atendimento humano · você");
    assert.equal(await visible(anaPage, "btnDevolver"), true);
    assert.equal(await visible(anaPage, "btnAssumir"), false, "quem atende não vê \"Assumir\"");
    assert.equal(await visible(anaPage, "threadWindow"), false, "sem aviso de janela com a janela aberta");

    await biaPage.waitFor(() => [...document.querySelectorAll(".thread-msg.human")].some((m) => /Ana Souza/.test(m.textContent)));
    await biaPage.waitFor(() => document.getElementById("threadStatus").textContent === "Atendimento humano · Ana Souza");
    assert.equal(await biaPage.eval(() => document.getElementById("btnAssumir").textContent), "Assumir de Ana");
    await anaPage.screenshot(path.join(SHOTS, "fase5-ana-atendendo.png"));
  });

  test("mensagem nova do cliente aparece nas duas telas e a IA não responde", async () => {
    await wa.text(PHONE, "Obrigado, Ana!");
    for (const page of [anaPage, biaPage]) {
      await page.waitFor(() => [...document.querySelectorAll(".thread-msg.user")].some((m) => m.textContent.includes("Obrigado, Ana!")));
    }
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await anaPage.eval(() => document.querySelector(".thread-msg:last-child").classList.contains("user")), true);
  });

  test("Bia responde por cima da Ana só depois de confirmar", async () => {
    await biaPage.eval(() => {
      document.getElementById("composerInput").value = "Oi, aqui é a Bia.";
      document.getElementById("composerSend").click();
    });
    await biaPage.waitFor(() => [...document.querySelectorAll(".thread-msg.human")].some((m) => m.textContent.includes("Oi, aqui é a Bia.")));
    assert.match(biaPage.dialogs.at(-1), /Ana Souza está atendendo esta conversa/);
    await anaPage.waitFor(() => document.getElementById("threadStatus").textContent === "Atendimento humano · Bia Lima");
  });

  test("Devolver à IA", async () => {
    await biaPage.eval(() => document.getElementById("btnDevolver").click());
    await anaPage.waitFor(() => document.getElementById("threadStatus").textContent === "IA respondendo");
    await biaPage.waitFor(() => document.getElementById("btnAssumir").textContent === "Assumir");
    assert.equal(await visible(biaPage, "btnDevolver"), false, "com a IA respondendo não há \"Devolver à IA\"");
    assert.equal(await visible(biaPage, "btnAssumir"), true);
  });

  test("conversa fora da janela de 24 h: caixa travada e aviso claro", async () => {
    await openItem(anaPage, OLD_PHONE);
    await anaPage.waitFor(() => !document.getElementById("threadWindow").hidden);
    assert.equal(await visible(anaPage, "threadWindow"), true);
    assert.equal(await anaPage.eval(() => document.getElementById("composerInput").disabled), true);
    assert.match(await anaPage.eval(() => document.getElementById("threadWindow").textContent), /Fora da janela de 24 h/);
    assert.match(await anaPage.eval(() => document.getElementById("threadWindow").textContent), /Nenhum modelo configurado/);
    assert.match(await anaPage.eval(() => document.getElementById("composerHint").textContent), /Modo simulado/);
    await anaPage.screenshot(path.join(SHOTS, "fase5-fora-da-janela.png"));
  });

  test("mensagem que falhou aparece em vermelho e pode ser reenviada", async () => {
    // aviso de ligação fora da janela (registrado como não enviado)
    const when = new Date(Date.now() + 5 * HOURS).toISOString();
    await anaPage.eval(`window.Dash.api("/api/crm/cases/c-old/call", { method: "PUT", body: { scheduledAt: ${JSON.stringify(when)} } })`);
    await anaPage.waitFor(() => document.querySelector(".thread-msg.is-failed .msg-retry"));
    assert.match(await anaPage.eval(() => document.querySelector(".thread-msg.is-failed").textContent), /Não enviada: Fora da janela de 24 h/);
    const dialogsBefore = anaPage.dialogs.length;
    await anaPage.eval(() => document.querySelector(".msg-retry").click());
    // fora da janela o reenvio é recusado com explicação (alert)
    await until(() => anaPage.dialogs.length > dialogsBefore, { what: "o aviso do reenvio" });
    assert.match(anaPage.dialogs.at(-1), /Fora da janela de 24 h/);
  });

  test("nenhum erro de JavaScript nas duas telas", () => {
    assert.deepEqual(anaPage.errors, []);
    assert.deepEqual(biaPage.errors, []);
  });
});
