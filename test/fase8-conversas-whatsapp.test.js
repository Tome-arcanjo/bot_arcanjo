/**
 * Conversas estilo WhatsApp: anexos (recebidos e enviados), respostas
 * citadas, reações, editar/apagar (dentro do que a Cloud API permite),
 * encaminhar, fila de "Atendimento pendente", transferir, encerrar e
 * etiquetas jurídicas — contra uma Graph API falsa.
 */
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

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const PDF = Buffer.from("%PDF-1.4\n% peticao de teste\n%%EOF");

async function logged(server, who) {
  const client = makeClient(server.url);
  await loginAs(client, who);
  return client;
}

const sessionOf = (server, phone) => (server.readDb().sessions || []).find((s) => s.phone === phone);
function messagesOf(server, phone) {
  const session = sessionOf(server, phone);
  return (server.readDb().messages || []).filter((m) => m.session_id === session?.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function graphEnv(graph) {
  return {
    ...EMERGENCY_ENV,
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_SEND_ENABLED: "true",
    WHATSAPP_TOKEN: "token-de-teste",
    WHATSAPP_PHONE_NUMBER_ID: "123456",
    WHATSAPP_GRAPH_URL: graph.url,
  };
}

describe("conversas estilo WhatsApp (API + Graph falsa)", () => {
  const PHONE = "5511966661111";
  const PHONE2 = "5511966662222";
  let graph;
  let server;
  let wa;
  let ana;
  let bia;
  let caio;
  let anaStream;

  before(async () => {
    graph = await startFakeGraph({
      media: {
        "wamedia.img1": { mime: "image/jpeg", data: JPEG },
        "wamedia.html": { mime: "text/html", data: Buffer.from("<script>alert(1)</script>") },
      },
    });
    server = await startServer({ env: graphEnv(graph), db: { users: teamRows() } });
    wa = webhook(server);
    ana = await logged(server, TEAM.ana);
    bia = await logged(server, TEAM.bia);
    caio = await logged(server, TEAM.caio);
    anaStream = sseReader(await ana.request("/api/conversas/stream"));
  });
  after(async () => {
    anaStream.close();
    await server.stop();
    await graph.close();
  });

  test("cliente manda imagem com legenda: o arquivo é baixado da Meta e servido só com login", async () => {
    await wa.media(PHONE, "image", { id: "wamedia.img1", mime_type: "image/jpeg", caption: "Minha carteira de trabalho" }, { name: "Rita Souza" });
    const msg = await until(() => messagesOf(server, PHONE).find((m) => m.message_type === "image"), { what: "a imagem" });
    assert.equal(msg.media.mime, "image/jpeg");
    assert.equal(msg.media.caption, "Minha carteira de trabalho");
    assert.match(msg.content, /\[O cliente enviou uma imagem\]: Minha carteira/);
    assert.ok(msg.wa_message_id);

    const res = await bia.request(`/api/conversas/media/${msg.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), JPEG);
    assert.equal((await makeClient(server.url).request(`/api/conversas/media/${msg.id}`)).status, 401);

    // Com a IA ativa, ela avisa que só lê texto.
    await until(() => messagesOf(server, PHONE).some((m) => m.role === "assistant" && /ainda não consigo processar uma imagem/.test(m.content)), { what: "o aviso da IA" });
  });

  test("documento HTML do cliente nunca abre no painel (só download, com CSP sandbox)", async () => {
    await wa.media(PHONE, "document", { id: "wamedia.html", mime_type: "text/html", filename: "golpe.html" });
    const msg = await until(() => messagesOf(server, PHONE).find((m) => m.message_type === "document"), { what: "o documento" });
    const res = await bia.request(`/api/conversas/media/${msg.id}`);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.match(res.headers.get("content-disposition"), /^attachment/);
    assert.equal(res.headers.get("content-security-policy"), "sandbox");
  });

  test("webhook repetido pela Meta não duplica, e a resposta citada fica ligada", async () => {
    const id = "wamid.repetido.1";
    await wa.text(PHONE, "Mensagem única", { id });
    await wa.text(PHONE, "Mensagem única", { id });
    await until(() => messagesOf(server, PHONE).some((m) => m.wa_message_id === id), { what: "a mensagem" });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(messagesOf(server, PHONE).filter((m) => m.wa_message_id === id).length, 1);

    await wa.text(PHONE, "Respondendo àquela", { context: id });
    const reply = await until(() => messagesOf(server, PHONE).find((m) => m.content === "Respondendo àquela"), { what: "a resposta citada" });
    assert.equal(reply.reply_to_id, messagesOf(server, PHONE).find((m) => m.wa_message_id === id).id);
  });

  test("reação do cliente aparece na mensagem (e some quando ele tira)", async () => {
    const target = messagesOf(server, PHONE).find((m) => m.role === "assistant" && m.wa_message_id);
    await wa.reaction(PHONE, target.wa_message_id, "❤️");
    await until(() => messagesOf(server, PHONE).find((m) => m.id === target.id).reactions.some((r) => r.from === "client" && r.emoji === "❤️"), { what: "a reação" });
    const ev = await anaStream.waitFor((e) => e.event === "update" && e.data.message.id === target.id);
    assert.equal(ev.data.message.reactions[0].emoji, "❤️");
    await wa.reaction(PHONE, target.wa_message_id, "");
    await until(() => messagesOf(server, PHONE).find((m) => m.id === target.id).reactions.length === 0, { what: "a reação removida" });
  });

  test("equipe responde citando e envia documento; figurinha precisa ser WebP", async () => {
    const session = sessionOf(server, PHONE);
    const quoted = messagesOf(server, PHONE).find((m) => m.message_type === "image");
    let res = await bia.request(`/api/conversas/${session.id}/messages`, { method: "POST", json: { content: "Recebi, obrigado!", replyTo: quoted.id } });
    assert.equal(res.status, 200);
    let send = graph.sends().at(-1);
    assert.equal(send.body.context.message_id, quoted.wa_message_id);

    res = await bia.request(`/api/conversas/${session.id}/media?mime=application/pdf&name=peticao.pdf&caption=Segue+a+peti%C3%A7%C3%A3o`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: PDF,
    });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.message_type, "document");
    assert.equal(data.delivery_status, "sent");
    assert.equal(graph.uploads().length, 1);
    send = graph.sends().at(-1);
    assert.equal(send.body.type, "document");
    assert.equal(send.body.document.filename, "peticao.pdf");
    assert.equal(send.body.document.caption, "Segue a petição");
    assert.match(send.body.document.id, /^media\.out\./);

    res = await bia.request(`/api/conversas/${session.id}/media?mime=image/png&name=x.png&kind=sticker`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: JPEG,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /WebP/);
  });

  test("reagir manda a reação para a Meta", async () => {
    const target = messagesOf(server, PHONE).find((m) => m.message_type === "image");
    const res = await bia.request(`/api/conversas/messages/${target.id}/react`, { method: "POST", json: { emoji: "👍" } });
    assert.equal(res.status, 200);
    const send = graph.sends().at(-1);
    assert.deepEqual(send.body.reaction, { message_id: target.wa_message_id, emoji: "👍" });
    assert.deepEqual((await res.json()).data.reactions.map((r) => [r.from, r.emoji, r.name]), [["team", "👍", "Bia Lima"]]);
  });

  test("editar envia uma correção citando a original; apagar vale só no painel e só para autor/admin", async () => {
    const original = messagesOf(server, PHONE).find((m) => m.content === "Recebi, obrigado!");
    let res = await bia.request(`/api/conversas/messages/${original.id}`, { method: "PATCH", json: { content: "Recebi, muito obrigado!" } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.edited_at);
    assert.equal(body.correction.content, "*Correção:* Recebi, muito obrigado!");
    assert.equal(body.correction.reply_to_id, original.id);
    assert.equal(graph.sends().at(-1).body.context.message_id, original.wa_message_id);

    assert.equal((await caio.request(`/api/conversas/messages/${original.id}`, { method: "DELETE" })).status, 403);
    res = await ana.request(`/api/conversas/messages/${original.id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    const deleted = (await res.json()).data;
    assert.ok(deleted.deleted_at);
    assert.equal(deleted.deleted_by_name, "Ana Souza");
    // mensagem do cliente não se apaga
    const fromClient = messagesOf(server, PHONE).find((m) => m.role === "user");
    assert.equal((await ana.request(`/api/conversas/messages/${fromClient.id}`, { method: "DELETE" })).status, 409);
  });

  test("encaminhar um documento para outro cliente", async () => {
    await wa.text(PHONE2, "Oi, também preciso de ajuda", { name: "Pedro" });
    const target = await until(() => sessionOf(server, PHONE2), { what: "a segunda conversa" });
    const doc = messagesOf(server, PHONE).find((m) => m.message_type === "document" && m.role === "human");
    const res = await bia.request(`/api/conversas/messages/${doc.id}/forward`, { method: "POST", json: { sessionIds: [target.id] } });
    const { data } = await res.json();
    assert.equal(data[0].ok, true);
    const fwd = messagesOf(server, PHONE2).find((m) => m.forwarded);
    assert.equal(fwd.message_type, "document");
    assert.equal(fwd.media.path, doc.media.path);
    assert.equal(graph.sends().at(-1).body.to, PHONE2);
  });

  test("fila: entra ao escrever, sai ao assumir, transferir e encerrar; volta ao escrever de novo", async () => {
    const PHONE3 = "5511966663333";
    await wa.text(PHONE3, "Bom dia", { name: "Lia" });
    const s = await until(() => sessionOf(server, PHONE3)?.queue_since && sessionOf(server, PHONE3), { what: "a entrada na fila" });

    let res = await bia.request(`/api/conversas/${s.id}/assume`, { method: "POST", json: {} });
    let data = (await res.json()).data;
    assert.equal(data.queue_since, null);
    assert.equal(data.board_stage, "Em atendimento");
    assert.equal(data.board_stage_changed_by, TEAM.bia.id);

    // transferir para quem está desativado não pode
    assert.equal((await bia.request(`/api/conversas/${s.id}/transfer`, { method: "POST", json: { userId: TEAM.duda.id } })).status, 400);
    // Caio não passa por cima da Bia sem confirmar
    res = await caio.request(`/api/conversas/${s.id}/transfer`, { method: "POST", json: { userId: TEAM.caio.id } });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "HANDLED_BY_OTHER");

    res = await bia.request(`/api/conversas/${s.id}/transfer`, { method: "POST", json: { userId: TEAM.caio.id } });
    data = (await res.json()).data;
    assert.equal(data.handler_user_id, TEAM.caio.id);
    assert.equal(data.ai_paused, true);
    const ev = await anaStream.waitFor((e) => e.event === "session" && e.data.session.id === s.id && e.data.session.handler_user_id === TEAM.caio.id);
    assert.equal(ev.data.actor.name, "Bia Lima");
    const event = server.readDb().case_events.find((e) => e.session_id === s.id && e.to_value === "Caio Rocha");
    assert.equal(event.user_id, TEAM.bia.id);

    res = await caio.request(`/api/conversas/${s.id}/close`, { method: "POST", json: {} });
    data = (await res.json()).data;
    assert.equal(data.board_stage, "Finalizado");
    assert.equal(data.ai_paused, false);
    assert.equal(data.handler_user_id, null);
    assert.equal(data.queue_since, null);

    await wa.text(PHONE3, "Esqueci de perguntar uma coisa", { name: "Lia" });
    await until(() => sessionOf(server, PHONE3).board_stage === "Aguardando atendimento" && sessionOf(server, PHONE3).queue_since, { what: "a volta para a fila" });
  });

  test("arrastar para Finalizado no quadro encerra o atendimento", async () => {
    const s = sessionOf(server, PHONE2);
    await bia.request(`/api/conversas/${s.id}/assume`, { method: "POST", json: {} });
    const res = await bia.request(`/api/conversas/${s.id}/stage`, { method: "PATCH", json: { stage: "Finalizado" } });
    const { data } = await res.json();
    assert.equal(data.ai_paused, false);
    assert.equal(data.board_stage, "Finalizado");
  });

  test("etiquetas jurídicas: salvas no cliente, avisadas pelo SSE e listadas nas conversas", async () => {
    let res = await bia.request(`/api/contatos/${PHONE}/tags`, { method: "PUT", json: { tags: ["audiencia-agendada", "aguardando-documentacao"] } });
    assert.equal(res.status, 200);
    const ev = await anaStream.waitFor((e) => e.event === "client" && e.data.phone === PHONE);
    assert.deepEqual(ev.data.tags, ["audiencia-agendada", "aguardando-documentacao"]);
    assert.equal(ev.data.actor.name, "Bia Lima");

    res = await bia.request(`/api/contatos/${PHONE}/tags`, { method: "PUT", json: { tags: ["tag-inventada"] } });
    assert.equal(res.status, 400);

    const { data } = await (await bia.request("/api/conversas")).json();
    assert.deepEqual(data.find((s) => s.phone === PHONE).client_tags, ["audiencia-agendada", "aguardando-documentacao"]);
    const page = await (await bia.request("/dashboard/conversas")).text();
    assert.match(page, /"id":"audiencia-cancelada"/, "o catálogo de etiquetas vem no layout");
    assert.match(page, /window\.CONVERSAS_BOOT = \{"conversations":\[/, "a lista já vem no HTML");
  });

  test("equipe mostra quem está online (painel aberto)", async () => {
    const { data } = await (await bia.request("/api/crm/users")).json();
    assert.equal(data.find((u) => u.id === TEAM.ana.id).online, true);
    assert.equal(data.find((u) => u.id === TEAM.caio.id).online, false);
  });
});

describe("Conversas no navegador: abas, fila, contatos, menu da mensagem, anexos, etiquetas, transferir e encerrar", { skip: noBrowser }, () => {
  const t = (min) => new Date(Date.now() - min * 60000).toISOString();
  const session = (id, phone, name, extra) => ({ id, phone, contact_name: name, title: "WhatsApp", provider: "anthropic", ai_paused: false, board_stage: "Aguardando atendimento", created_at: t(90), updated_at: t(1), ...extra });
  const msg = (id, sessionId, role, content, min, extra) => ({ id, session_id: sessionId, role, content, message_type: "text", reactions: [], created_at: t(min), ...extra });
  let server;
  let browser;
  let anaPage;
  let biaPage;

  async function openConversas(who) {
    const client = await logged(server, who);
    const page = await browser.newPage(server.url);
    await page.login(client.jar.get("connect.sid"));
    await page.goto("/dashboard/conversas");
    await page.waitFor(() => document.querySelectorAll(".conversa-item").length > 0);
    return page;
  }
  const ids = (page) => page.eval(() => [...document.querySelectorAll(".conversa-item")].map((b) => b.dataset.id));
  const open = (page, id) => page.eval(`document.querySelector('.conversa-item[data-id="${id}"]').click()`);

  before(async () => {
    server = await startServer({
      env: { ...EMERGENCY_ENV, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_SIMULATE: "true" },
      db: {
        users: teamRows(),
        sessions: [
          session("p-new", "5511955550001", "Recém Chegado", { queue_since: t(2) }),
          session("p-old", "5511955550002", "Esperando Muito", { queue_since: t(80) }),
          session("p-mid", "5511955550003", "Meio Termo", { queue_since: t(20) }),
          session("c-ana", "5511955550004", "Cliente da Ana", { ai_paused: true, handler_user_id: TEAM.ana.id, board_stage: "Em atendimento" }),
        ],
        messages: [
          msg("m1", "p-old", "user", "Preciso falar com um advogado", 80, { wa_message_id: "wamid.p-old.1" }),
          msg("m2", "p-old", "assistant", "Já anotei, alguém da equipe vai te atender.", 79, { wa_message_id: "sim-1", delivery_status: "sent" }),
          msg("m3", "p-mid", "user", "Oi", 20),
          msg("m4", "p-new", "user", "Olá", 2),
          msg("m5", "c-ana", "user", "Obrigado, Ana", 3),
        ],
        clients: [{ phone: "5511955550002", name: "José Esperando", tags: ["prioridade-legal"] }],
      },
    });
    browser = await launchBrowser();
    anaPage = await openConversas(TEAM.ana);
    biaPage = await openConversas(TEAM.bia);
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test("Pendentes é uma fila: quem espera há mais tempo primeiro, e a ordem pode mudar", async () => {
    // Bia não atende ninguém: abre na fila. Ana já tem um chat: abre em Chats.
    assert.equal(await biaPage.eval(() => document.querySelector(".conv-tab.active").dataset.tab), "pendentes");
    assert.equal(await anaPage.eval(() => document.querySelector(".conv-tab.active").dataset.tab), "chats");
    assert.deepEqual(await ids(biaPage), ["p-old", "p-mid", "p-new"]);
    assert.match(await biaPage.eval(() => document.querySelector('.conversa-item[data-id="p-old"] .conversa-wait').textContent), /1 h 20 min/);
    assert.match(await biaPage.eval(() => document.querySelector('[data-tab="pendentes"] .conv-tab-count').textContent), /3/);

    await biaPage.eval(() => {
      const sort = document.getElementById("convSort");
      sort.value = "wait-asc";
      sort.dispatchEvent(new Event("change"));
    });
    assert.deepEqual(await ids(biaPage), ["p-new", "p-mid", "p-old"]);
    await biaPage.eval(() => {
      const sort = document.getElementById("convSort");
      sort.value = "wait-desc";
      sort.dispatchEvent(new Event("change"));
    });
    // filtro por etiqueta
    await biaPage.eval(() => {
      const f = document.getElementById("convTagFilter");
      f.value = "prioridade-legal";
      f.dispatchEvent(new Event("change"));
    });
    assert.deepEqual(await ids(biaPage), ["p-old"]);
    await biaPage.eval(() => {
      const f = document.getElementById("convTagFilter");
      f.value = "";
      f.dispatchEvent(new Event("change"));
    });
    await biaPage.screenshot(path.join(SHOTS, "fase8-fila-pendentes.png"));
  });

  test("responder citando pelo menu da mensagem: assume e vai para Chats", async () => {
    await open(biaPage, "p-old");
    await biaPage.waitFor(() => document.querySelectorAll(".thread-msg").length === 2);
    await biaPage.eval(() => document.querySelector('.thread-msg[data-id="m1"] .msg-more').click());
    await biaPage.waitFor(() => !document.getElementById("msgMenu").hidden);
    await biaPage.screenshot(path.join(SHOTS, "fase8-menu-mensagem.png"));
    await biaPage.eval(() => document.querySelector('#msgMenu [data-action="reply"]').click());
    assert.match(await biaPage.eval(() => document.getElementById("composerReply").textContent), /Cliente.*Preciso falar/s);

    await biaPage.eval(() => {
      document.getElementById("composerInput").value = "Oi José, sou a Bia e vou te atender agora 😊";
      document.getElementById("composerSend").click();
    });
    await biaPage.waitFor(() => document.querySelector(".thread-msg.human .msg-quote")?.textContent.includes("Preciso falar"));
    assert.equal(await biaPage.eval(() => document.querySelector(".conv-tab.active").dataset.tab), "chats");
    assert.equal(await biaPage.eval(() => document.getElementById("composerReply").hidden), true);
    const saved = server.readDb().messages.find((m) => m.content.startsWith("Oi José"));
    assert.equal(saved.reply_to_id, "m1");
    // Ana: o cliente sumiu da fila (Pendentes 2)
    await anaPage.waitFor(() => document.querySelector('[data-tab="pendentes"] .conv-tab-count').textContent === "2");
  });

  test("emoji, anexo e reação", async () => {
    await biaPage.eval(() => document.getElementById("btnEmoji").click());
    await biaPage.eval(() => document.querySelector('#emojiGrid [data-emoji="👍"]').click());
    assert.equal(await biaPage.eval(() => document.getElementById("composerInput").value), "👍");
    await biaPage.eval(() => (document.getElementById("composerInput").value = "Segue o modelo de procuração"));

    await biaPage.eval(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["%PDF-1.4 procuracao"], "procuracao.pdf", { type: "application/pdf" }));
      const input = document.getElementById("fileInput");
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
    });
    await biaPage.waitFor(() => document.querySelectorAll(".composer-file").length === 1);
    await biaPage.eval(() => document.getElementById("composerSend").click());
    await biaPage.waitFor(() => document.querySelector(".thread-msg.human .msg-doc-name")?.textContent === "procuracao.pdf");
    assert.match(await biaPage.eval(() => [...document.querySelectorAll(".thread-msg.human")].at(-1).textContent), /Segue o modelo de procuração/);

    // reação na mensagem do cliente
    await biaPage.eval(() => document.querySelector('.thread-msg[data-id="m1"] .msg-more').click());
    await biaPage.eval(() => document.querySelector('#msgMenu [data-react="🙏"]').click());
    await biaPage.waitFor(() => document.querySelector('.thread-msg[data-id="m1"] .msg-reaction')?.textContent === "🙏");
    await biaPage.screenshot(path.join(SHOTS, "fase8-conversa.png"));
  });

  test("etiquetas no painel do cliente aparecem para a Ana na hora", async () => {
    await biaPage.eval(() => document.getElementById("btnInfo").click());
    await biaPage.waitFor(() => !document.getElementById("contactDrawer").hidden);
    await biaPage.eval(() => document.querySelector('#contactDrawer [data-tag="audiencia-agendada"]').click());
    await anaPage.eval(() => document.querySelector('[data-tab="chats"]').click());
    await anaPage.waitFor(() => document.querySelector('.conversa-item[data-id="p-old"] .conversa-item-tags')?.textContent.includes("Audiência agendada"));
    await biaPage.screenshot(path.join(SHOTS, "fase8-dados-do-cliente.png"));
    assert.deepEqual(server.readDb().clients.find((c) => c.phone === "5511955550002").tags, ["prioridade-legal", "audiencia-agendada"]);
  });

  test("transferir para outra pessoa e encerrar o atendimento", async () => {
    await biaPage.eval(() => document.getElementById("btnTransferir").click());
    await biaPage.waitFor(() => document.querySelector('#transferList [data-transfer="u-ana"]'));
    // Ana está com o painel aberto: aparece online
    assert.match(await biaPage.eval(() => document.querySelector('#transferList [data-transfer="u-ana"]').textContent), /online/);
    await biaPage.eval(() => document.querySelector('#transferList [data-transfer="u-ana"]').click());
    await biaPage.waitFor(() => document.getElementById("threadStatus").textContent === "Atendimento humano · Ana Souza");
    await anaPage.waitFor(() => document.querySelector('.conversa-item[data-id="p-old"] .avatar.is-me'));
    assert.equal(server.readDb().sessions.find((s) => s.id === "p-old").handler_user_id, TEAM.ana.id);

    await open(anaPage, "p-old");
    await anaPage.waitFor(() => document.getElementById("threadTitle").textContent === "Esperando Muito");
    await anaPage.eval(() => document.getElementById("btnEncerrar").click());
    await anaPage.waitFor(() => document.getElementById("threadStatus").textContent === "Encerrado");
    assert.match(anaPage.dialogs.at(-1), /Encerrar o atendimento de Esperando Muito/);
    assert.equal(server.readDb().sessions.find((s) => s.id === "p-old").board_stage, "Finalizado");
    // encerrado: sai de Chats e Pendentes, e continua em Contatos
    assert.ok(!(await ids(anaPage)).includes("p-old"));
  });

  test("Contatos lista todos os clientes de A a Z, com a situação de cada um", async () => {
    await anaPage.eval(() => document.querySelector('[data-tab="contatos"]').click());
    assert.deepEqual(await ids(anaPage), ["c-ana", "p-old", "p-mid", "p-new"]);
    const letters = await anaPage.eval(() => [...document.querySelectorAll(".conv-letter")].map((l) => l.textContent));
    assert.deepEqual(letters, ["C", "E", "M", "R"]);
    const state = (id) => anaPage.eval(`document.querySelector('.conversa-item[data-id="${id}"] .conversa-state').textContent`);
    assert.equal(await state("p-old"), "Encerrado");
    assert.equal(await state("c-ana"), "Em atendimento · você");
    assert.equal(await state("p-new"), "Na fila");
    await anaPage.screenshot(path.join(SHOTS, "fase8-contatos.png"));
  });

  test("nenhum erro de JavaScript", () => {
    assert.deepEqual(anaPage.errors, []);
    assert.deepEqual(biaPage.errors, []);
  });
});
