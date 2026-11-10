/**
 * Nome do WhatsApp nas conversas e quadro de Atendimento (um card por
 * cliente, arrastado entre etapas). A foto de perfil não existe na Cloud API:
 * o painel mostra as iniciais do nome com uma cor fixa por telefone.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { startServer, makeClient, until } from "./support/server.js";
import { sseReader } from "./support/sse.js";
import { webhook, APP_SECRET } from "./support/whatsapp.js";
import { launchBrowser, findChrome } from "./support/browser.js";
import { TEAM, EMERGENCY_ENV, teamRows, loginAs } from "./support/seed.js";

const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "arcanjo-screens");
const noBrowser = findChrome() ? false : "nenhum Chrome/Edge encontrado (CHROME_PATH)";
const ENV = { ...EMERGENCY_ENV, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_SIMULATE: "true" };

async function logged(server, who) {
  const client = makeClient(server.url);
  await loginAs(client, who);
  return client;
}

const sessionOf = (server, phone) => (server.readDb().sessions || []).find((s) => s.phone === phone);

describe("nome do WhatsApp e quadro de Atendimento (API + SSE)", () => {
  const PHONE = "5511966660000";
  let server;
  let wa;
  let ana;
  let bia;
  let anaStream;

  before(async () => {
    server = await startServer({
      env: ENV,
      db: { users: teamRows(), clients: [{ phone: PHONE, name: "Maria Aparecida Souza" }] },
    });
    wa = webhook(server);
    ana = await logged(server, TEAM.ana);
    bia = await logged(server, TEAM.bia);
    anaStream = sseReader(await ana.request("/api/conversas/stream"));
  });
  after(async () => {
    anaStream.close();
    await server.stop();
  });

  test("o nome do perfil do WhatsApp fica salvo na conversa e acompanha a troca de nome", async () => {
    await wa.text(PHONE, "Oi, fui demitido", { name: "Maria 🌻" });
    await until(() => sessionOf(server, PHONE)?.contact_name === "Maria 🌻", { what: "o nome do WhatsApp" });

    await wa.text(PHONE, "Ainda está aí?", { name: "Maria Souza" });
    await until(() => sessionOf(server, PHONE)?.contact_name === "Maria Souza", { what: "o nome novo" });
    const ev = await anaStream.waitFor((e) => e.event === "session" && e.data.session.contact_name === "Maria Souza");
    assert.equal(ev.data.actor.name, "Sistema");

    // A lista traz também o nome do cadastro (Contatos), usado como reserva.
    const { data } = await (await bia.request("/api/conversas")).json();
    const conv = data.find((s) => s.phone === PHONE);
    assert.equal(conv.contact_name, "Maria Souza");
    assert.equal(conv.client_name, "Maria Aparecida Souza");
  });

  test("atendente move o cliente de coluna: grava quem moveu e todos recebem pelo SSE", async () => {
    const id = sessionOf(server, PHONE).id;
    const res = await bia.request(`/api/conversas/${id}/stage`, { method: "PATCH", json: { stage: "Em atendimento" } });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.board_stage, "Em atendimento");
    assert.equal(data.board_stage_changed_by, TEAM.bia.id);
    assert.equal(data.board_stage_changed_by_name, "Bia Lima");

    const ev = await anaStream.waitFor((e) => e.event === "session" && e.data.session.board_stage === "Em atendimento");
    assert.deepEqual(ev.data.actor, { id: TEAM.bia.id, name: "Bia Lima" });
  });

  test("coluna inválida é 400 e conversa inexistente é 404", async () => {
    const id = sessionOf(server, PHONE).id;
    assert.equal((await bia.request(`/api/conversas/${id}/stage`, { method: "PATCH", json: { stage: "Coluna inventada" } })).status, 400);
    assert.equal((await bia.request("/api/conversas/nao-existe/stage", { method: "PATCH", json: { stage: "Finalizado" } })).status, 404);
  });

  test("cliente finalizado que escreve de novo volta para Aguardando atendimento", async () => {
    const id = sessionOf(server, PHONE).id;
    await bia.request(`/api/conversas/${id}/stage`, { method: "PATCH", json: { stage: "Finalizado" } });
    await wa.text(PHONE, "Voltei, tenho mais uma dúvida", { name: "Maria Souza" });
    await until(() => sessionOf(server, PHONE)?.board_stage === "Aguardando atendimento", { what: "a reabertura" });
    const session = sessionOf(server, PHONE);
    assert.equal(session.board_stage_changed_by, null);
    assert.equal(session.board_stage_changed_by_name, "Sistema");
  });

  test("CRM de casos só para admin; Atendimento para todos", async () => {
    assert.equal((await bia.request("/dashboard/crm")).status, 403);
    assert.equal((await ana.request("/dashboard/crm")).status, 200);
    const page = await (await bia.request("/dashboard/atendimento")).text();
    assert.match(page, /window\.ATENDIMENTO_COLUMNS = \["Aguardando atendimento","Em atendimento","Aguardando cliente","Finalizado"\]/);
    assert.doesNotMatch(page, /href="\/dashboard\/crm"/);
    assert.match(await (await ana.request("/dashboard/atendimento")).text(), /href="\/dashboard\/crm"/);
  });
});

describe("quadro de Atendimento e Conversas no navegador", { skip: noBrowser }, () => {
  const t = (min) => new Date(Date.now() - min * 60000).toISOString();
  const session = (id, phone, extra, min) => ({ id, phone, title: "WhatsApp", provider: "anthropic", board_stage: "Aguardando atendimento", ai_paused: false, updated_at: t(min), created_at: t(min), ...extra });
  let server;
  let browser;
  let wa;
  let anaPage;
  let biaPage;

  async function openBoard(who) {
    const client = await logged(server, who);
    const page = await browser.newPage(server.url);
    await page.login(client.jar.get("connect.sid"));
    await page.goto("/dashboard/atendimento");
    await page.waitFor(() => document.querySelectorAll(".at-card").length >= 3 && document.getElementById("atLive").dataset.state === "on");
    return page;
  }

  const card = (id) => `[...document.querySelectorAll(".at-card")].find((c) => c.dataset.id === ${JSON.stringify(id)})`;
  const stageOfCard = (page, id) => page.eval(`(() => { const c = ${card(id)}; return c ? c.closest(".crm-column").dataset.stage : null; })()`);

  before(async () => {
    server = await startServer({
      env: ENV,
      db: {
        users: teamRows(),
        sessions: [
          session("s1", "5511977770001", { contact_name: "João Pedro" }, 1),
          session("s2", "5511977770002", { contact_name: "Carla", ai_paused: true, handler_user_id: TEAM.ana.id, board_stage: "Em atendimento" }, 5),
          session("s3", "5511977770003", {}, 9), // sem nome do WhatsApp: usa o cadastro
        ],
        clients: [{ phone: "5511977770003", name: "Roberto Dias" }],
        messages: [{ id: "m1", session_id: "s1", role: "user", content: "Preciso de ajuda com a rescisão", created_at: t(1) }],
      },
    });
    wa = webhook(server);
    browser = await launchBrowser();
    anaPage = await openBoard(TEAM.ana);
    biaPage = await openBoard(TEAM.bia);
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test("cards com avatar de iniciais, nome do WhatsApp, telefone, prévia e quem atende", async () => {
    const s1 = await biaPage.eval(`(() => { const c = ${card("s1")}; return { avatar: c.querySelector(".avatar-contact").textContent, name: c.querySelector(".at-card-name").textContent, phone: c.querySelector(".at-card-phone").textContent, preview: c.querySelector(".at-card-preview").textContent, handler: c.querySelector(".at-card-handler").textContent }; })()`);
    assert.deepEqual(s1, { avatar: "JP", name: "João Pedro", phone: "+55 11 97777-0001", preview: "Preciso de ajuda com a rescisão", handler: "IARobô" });
    assert.equal(await biaPage.eval(`${card("s3")}.querySelector(".at-card-name").textContent`), "Roberto Dias");
    assert.equal(await biaPage.eval(`${card("s2")}.querySelector(".at-handler-name").textContent`), "Ana");
    assert.equal(await stageOfCard(biaPage, "s2"), "Em atendimento");
    await biaPage.screenshot(path.join(SHOTS, "fase7-quadro-atendimento.png"));
  });

  test("Bia arrasta um cliente e a Ana vê na hora, com aviso", async () => {
    await biaPage.eval(`(() => {
      const c = ${card("s1")};
      const col = [...document.querySelectorAll(".crm-column")].find((x) => x.dataset.stage === "Aguardando cliente");
      const dt = new DataTransfer();
      c.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      col.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      c.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    })()`);
    await anaPage.waitFor(`(() => { const c = ${card("s1")}; return c && c.closest(".crm-column").dataset.stage === "Aguardando cliente" && c.classList.contains("is-remote"); })()`);
    const toast = await anaPage.waitFor(() => document.querySelector(".crm-toast")?.textContent);
    assert.match(toast, /Bia Lima moveu João Pedro para Aguardando cliente/);
    assert.match(await anaPage.eval(`${card("s1")}.querySelector(".at-card-moved").textContent`), /movido por Bia/);
    assert.equal(server.readDb().sessions.find((s) => s.id === "s1").board_stage, "Aguardando cliente");
  });

  test("cliente novo no WhatsApp aparece no quadro com o nome do perfil", async () => {
    await wa.text("5511977770009", "Boa tarde, preciso de um advogado", { name: "Fernanda Lima" });
    const name = await biaPage.waitFor(() => {
      const c = [...document.querySelectorAll(".at-card")].find((x) => x.querySelector(".at-card-phone")?.textContent === "+55 11 97777-0009");
      return c && c.closest(".crm-column").dataset.stage === "Aguardando atendimento" && c.querySelector(".at-card-name").textContent;
    });
    assert.equal(name, "Fernanda Lima");
    assert.equal(await biaPage.eval(() => document.querySelector(".at-card .avatar-contact")?.textContent.length > 0), true);
  });

  test("busca por nome ou telefone e filtro Meus atendimentos", async () => {
    await anaPage.eval(() => {
      const el = document.getElementById("atSearch");
      el.value = "carla";
      el.dispatchEvent(new Event("input"));
    });
    assert.deepEqual(await anaPage.eval(() => [...document.querySelectorAll(".at-card")].map((c) => c.dataset.id)), ["s2"]);
    await anaPage.eval(() => {
      const el = document.getElementById("atSearch");
      el.value = "97777-0003";
      el.dispatchEvent(new Event("input"));
    });
    assert.deepEqual(await anaPage.eval(() => [...document.querySelectorAll(".at-card")].map((c) => c.dataset.id)), ["s3"]);
    await anaPage.eval(() => {
      const el = document.getElementById("atSearch");
      el.value = "";
      el.dispatchEvent(new Event("input"));
      document.querySelector('[data-filter="mine"]').click();
    });
    assert.deepEqual(await anaPage.eval(() => [...document.querySelectorAll(".at-card")].map((c) => c.dataset.id)), ["s2"]);
    await anaPage.eval(() => document.querySelector('[data-filter="all"]').click());
  });

  test("clicar no card abre a conversa com o nome e o avatar no cabeçalho", async () => {
    await biaPage.eval(`${card("s1")}.click()`);
    await biaPage.waitFor(() => location.pathname === "/dashboard/conversas" && document.getElementById("threadTitle").textContent === "João Pedro");
    assert.equal(await biaPage.eval(() => document.querySelector("#threadAvatar .avatar-contact").textContent), "JP");
    const sub = await biaPage.eval(() => document.getElementById("threadSub").textContent);
    assert.match(sub, /\+55 11 97777-0001/);
    assert.doesNotMatch(sub, /Ver no CRM/, "atendente não tem link para o CRM");
    const item = await biaPage.eval(() => document.querySelector('.conversa-item[data-phone="5511977770001"] .conversa-item-title').textContent);
    assert.equal(item, "João Pedro");
    await biaPage.screenshot(path.join(SHOTS, "fase7-conversa-com-nome.png"));
  });

  test("nenhum erro de JavaScript", () => {
    assert.deepEqual(anaPage.errors, []);
    assert.deepEqual(biaPage.errors, []);
  });
});
