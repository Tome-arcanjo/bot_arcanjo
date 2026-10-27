import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import { startServer, makeClient } from "./support/server.js";
import { sseReader } from "./support/sse.js";
import { launchBrowser, findChrome } from "./support/browser.js";
import { TEAM, EMERGENCY_ENV, teamRows, loginAs } from "./support/seed.js";

const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "arcanjo-screens");
const noBrowser = findChrome() ? false : "nenhum Chrome/Edge encontrado (CHROME_PATH)";

function seedCases() {
  const t = (min) => new Date(Date.now() - min * 60000).toISOString();
  return [
    { id: "c1", phone: "5511911111111", client_name: "Maria Silva", status: "Novo caso", urgency_tag: "Alta", area_tag: "Rescisão", summary: "Demitida sem receber as verbas.", updated_at: t(1), created_at: t(60) },
    { id: "c2", phone: "5511922222222", client_name: "João Pereira", status: "Em análise", urgency_tag: "Normal", assigned_to: "u-ana", updated_at: t(5), created_at: t(90), status_changed_by_name: "Ana Souza", status_changed_at: t(5) },
    { id: "c3", phone: "5511933333333", client_name: "Carla Dias", status: "Novo caso", urgency_tag: "Crítico", assigned_to: "u-bia", updated_at: t(10), created_at: t(120) },
  ];
}

const db = () => ({ users: teamRows(), crm_cases: seedCases(), case_events: [] });

async function logged(server, who) {
  const client = makeClient(server.url);
  await loginAs(client, who);
  return client;
}

async function stream(client) {
  return sseReader(await client.request("/api/crm/stream"));
}

describe("Kanban compartilhado (API + SSE)", () => {
  let server;
  let ana;
  let bia;
  let anaStream;
  let biaStream;
  before(async () => {
    server = await startServer({ env: EMERGENCY_ENV, db: db() });
    ana = await logged(server, TEAM.ana);
    bia = await logged(server, TEAM.bia);
    anaStream = await stream(ana);
    biaStream = await stream(bia);
  });
  after(async () => {
    anaStream.close();
    biaStream.close();
    await server.stop();
  });

  test("mover: todos recebem o evento com o autor, e o histórico registra", async () => {
    const res = await bia.request("/api/crm/cases/c1/status", { method: "PATCH", json: { status: "Em análise" } });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.status_changed_by_name, "Bia Lima");
    assert.equal(data.status_changed_by, "u-bia");

    for (const s of [anaStream, biaStream]) {
      const ev = await s.waitFor((e) => e.event === "crm" && e.data.type === "moved" && e.data.caseId === "c1");
      assert.deepEqual(ev.data.actor, { id: "u-bia", name: "Bia Lima" });
      assert.equal(ev.data.from, "Novo caso");
      assert.equal(ev.data.to, "Em análise");
      assert.equal(ev.data.case.status, "Em análise");
    }
    const event = server.readDb().case_events.find((e) => e.case_id === "c1" && e.type === "moved");
    assert.equal(event.user_id, "u-bia");
    assert.equal(event.actor_name, "Bia Lima");
    assert.equal(event.from_value, "Novo caso");
  });

  test("status inválido dá 400; caso inexistente dá 404", async () => {
    const bad = await bia.request("/api/crm/cases/c1/status", { method: "PATCH", json: { status: "Coluna inventada" } });
    assert.equal(bad.status, 400);
    const missing = await bia.request("/api/crm/cases/nao-existe/status", { method: "PATCH", json: { status: "Recurso" } });
    assert.equal(missing.status, 404);
  });

  test("atribuir, transferir e tirar o responsável", async () => {
    let res = await bia.request("/api/crm/cases/c1/assign", { method: "PATCH", json: { userId: "u-caio" } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.assigned_to, "u-caio");
    let ev = await anaStream.waitFor((e) => e.data.type === "assigned" && e.data.caseId === "c1");
    assert.equal(ev.data.to, "Caio Rocha");
    assert.equal(ev.data.from, null);

    res = await ana.request("/api/crm/cases/c1/assign", { method: "PATCH", json: { userId: "u-ana" } });
    ev = await biaStream.waitFor((e) => e.data.type === "assigned" && e.data.caseId === "c1" && e.data.to === "Ana Souza");
    assert.equal(ev.data.from, "Caio Rocha");
    assert.equal(ev.data.actor.name, "Ana Souza");

    const inactive = await ana.request("/api/crm/cases/c1/assign", { method: "PATCH", json: { userId: "u-duda" } });
    assert.equal(inactive.status, 400);

    res = await ana.request("/api/crm/cases/c1/assign", { method: "PATCH", json: { userId: null } });
    assert.equal((await res.json()).data.assigned_to, null);

    const assigned = server.readDb().case_events.filter((e) => e.case_id === "c1" && e.type === "assigned");
    assert.deepEqual(assigned.map((e) => [e.from_value, e.to_value]), [
      [null, "Caio Rocha"],
      ["Caio Rocha", "Ana Souza"],
      ["Ana Souza", null],
    ]);
  });

  test("criar, etiquetas, ligação e exclusão também chegam em tempo real", async () => {
    const created = await (await bia.request("/api/crm/cases", { method: "POST", json: { phone: "5511944444444", clientName: "Novo Cliente" } })).json();
    const id = created.data.id;
    await anaStream.waitFor((e) => e.data.type === "created" && e.data.caseId === id);

    await bia.request(`/api/crm/cases/${id}/tags`, { method: "PATCH", json: { urgency_tag: "Alta", area_tag: "Trabalhista" } });
    const tags = await anaStream.waitFor((e) => e.data.type === "tags" && e.data.caseId === id);
    assert.equal(tags.data.to, "Alta · Trabalhista");

    const when = new Date(Date.now() + 86400000).toISOString();
    await bia.request(`/api/crm/cases/${id}/call`, { method: "PUT", json: { scheduledAt: when } });
    const call = await anaStream.waitFor((e) => e.data.type === "call" && e.data.caseId === id);
    assert.match(call.data.to, /^Agendada para /);
    assert.equal(call.data.case.call_status, "pendente");

    const del = await ana.request(`/api/crm/cases/${id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    const gone = await biaStream.waitFor((e) => e.data.type === "deleted" && e.data.caseId === id);
    assert.equal(gone.data.case, null);

    // o histórico sobrevive à exclusão do caso
    const types = server.readDb().case_events.filter((e) => e.case_id === id).map((e) => e.type);
    assert.deepEqual(types, ["created", "tags", "call", "deleted"]);
    const history = await (await ana.request(`/api/crm/cases/${id}/events`)).json();
    assert.equal(history.data[0].type, "deleted");
  });

  test("conflito: dois movem o mesmo card ao mesmo tempo — vale o último e todos convergem", async () => {
    const [r1, r2] = await Promise.all([
      ana.request("/api/crm/cases/c3/status", { method: "PATCH", json: { status: "Recurso" } }),
      bia.request("/api/crm/cases/c3/status", { method: "PATCH", json: { status: "Finalizado" } }),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const final = server.readDb().crm_cases.find((c) => c.id === "c3").status;

    for (const s of [anaStream, biaStream]) {
      await s.waitFor(() => {
        const moves = s.events.filter((e) => e.data.type === "moved" && e.data.caseId === "c3");
        return moves.length === 2 && moves.at(-1).data.case.status === final;
      });
    }
  });

  test("usuário desativado tem o stream do CRM encerrado", async () => {
    const caio = await logged(server, TEAM.caio);
    const s = await stream(caio);
    await ana.request(`/api/users/${TEAM.caio.id}`, { method: "PATCH", json: { active: false } });
    await s.waitEnd();
  });
});

describe("Kanban no navegador (Ana e Bia ao mesmo tempo)", { skip: noBrowser }, () => {
  let server;
  let browser;
  let anaPage;
  let biaPage;

  async function openCrm(who) {
    const client = await logged(server, who);
    const page = await browser.newPage(server.url);
    await page.login(client.jar.get("connect.sid"));
    await page.goto("/dashboard/crm");
    await page.waitFor(() => document.querySelectorAll(".crm-card").length > 0 && document.getElementById("crmLive").dataset.state === "on");
    return page;
  }

  // Arrasta um card para outra coluna com eventos de drag sintéticos.
  function dragTo(page, caseId, status, { drop = true } = {}) {
    return page.eval(`(() => {
      const card = [...document.querySelectorAll(".crm-card")].find((c) => c.dataset.id === ${JSON.stringify(caseId)});
      const col = [...document.querySelectorAll(".crm-column")].find((c) => c.dataset.status === ${JSON.stringify(status)});
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      if (${drop}) {
        col.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        col.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      }
      return true;
    })()`);
  }

  const columnOf = (page, caseId) =>
    page.eval(`(() => { const c = [...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === ${JSON.stringify(caseId)}); return c ? c.closest(".crm-column").dataset.status : null; })()`);

  before(async () => {
    server = await startServer({ env: EMERGENCY_ENV, db: db() });
    browser = await launchBrowser();
    anaPage = await openCrm(TEAM.ana);
    biaPage = await openCrm(TEAM.bia);
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test("Bia arrasta um card e a Ana vê na hora, com aviso discreto", async () => {
    await dragTo(biaPage, "c1", "Documentos pendentes");
    assert.equal(await columnOf(biaPage, "c1"), "Documentos pendentes");

    await anaPage.waitFor(`(() => { const c = [...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c1"); return c && c.closest(".crm-column").dataset.status === "Documentos pendentes" && c.classList.contains("is-remote"); })()`);
    const toast = await anaPage.waitFor(() => document.querySelector(".crm-toast")?.textContent);
    assert.match(toast, /Bia Lima moveu Maria Silva para Documentos pendentes/);
    const moved = await anaPage.eval(`[...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c1").querySelector("[data-history]").textContent`);
    assert.match(moved, /movido por Bia/);
    // quem fez a ação não recebe aviso da própria mudança
    assert.equal(await biaPage.eval(() => document.querySelectorAll(".crm-toast").length), 0);
    await anaPage.screenshot(path.join(SHOTS, "fase4-ana-ve-mudanca.png"));
    assert.equal(server.readDb().crm_cases.find((c) => c.id === "c1").status, "Documentos pendentes");
  });

  test("o quadro não é redesenhado enquanto alguém arrasta; a mudança entra ao soltar", async () => {
    await dragTo(anaPage, "c2", "Recurso", { drop: false }); // Ana segurando o card
    await biaPage.eval(() => window.Dash.api("/api/crm/cases/c3/assign", { method: "PATCH", body: { userId: "u-caio" } }));
    await new Promise((r) => setTimeout(r, 600));
    assert.match(await anaPage.eval(`[...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c3").querySelector(".crm-assign-name").textContent`), /Bia/);
    assert.equal(await anaPage.eval(`[...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c2").classList.contains("dragging")`), true);

    await anaPage.eval(`[...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c2").dispatchEvent(new DragEvent("dragend", { bubbles: true }))`);
    await anaPage.waitFor(`/Caio/.test([...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c3").querySelector(".crm-assign-name").textContent)`);
  });

  test("atribuir pelo menu do card e filtrar Meus casos / Sem responsável", async () => {
    await anaPage.eval(`[...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c1").querySelector("[data-assign]").click()`);
    await anaPage.waitFor(() => !document.getElementById("crmAssignMenu").hidden);
    await anaPage.screenshot(path.join(SHOTS, "fase4-menu-responsavel.png"));
    await anaPage.eval(() => document.querySelector('#crmAssignMenu [data-user-id="u-ana"]').click());
    await anaPage.waitFor(`/Ana/.test([...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c1").querySelector(".crm-assign-name").textContent)`);
    await biaPage.waitFor(`/Ana/.test([...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c1").querySelector(".crm-assign-name").textContent)`);
    assert.equal(server.readDb().crm_cases.find((c) => c.id === "c1").assigned_to, "u-ana");

    await anaPage.eval(() => document.querySelector('[data-filter="mine"]').click());
    const mine = await anaPage.eval(() => [...document.querySelectorAll(".crm-card")].map((c) => c.dataset.id).sort());
    assert.deepEqual(mine, ["c1", "c2"]);
    await anaPage.screenshot(path.join(SHOTS, "fase4-meus-casos.png"));

    // o filtro fica lembrado depois de recarregar
    await anaPage.goto("/dashboard/crm");
    await anaPage.waitFor(() => document.querySelector('[data-filter="mine"]').classList.contains("active"));
    await anaPage.waitFor(() => document.querySelectorAll(".crm-card").length === 2);

    await anaPage.eval(() => document.querySelector('[data-filter="unassigned"]').click());
    assert.equal(await anaPage.eval(() => document.querySelectorAll(".crm-card").length), 0);
    await anaPage.eval(() => document.querySelector('[data-filter="all"]').click());
    assert.equal(await anaPage.eval(() => document.querySelectorAll(".crm-card").length), 3);
  });

  test("histórico do caso e botão de excluir só para admin", async () => {
    assert.ok(await anaPage.eval(() => document.querySelectorAll(".crm-card-delete").length === 3));
    assert.equal(await biaPage.eval(() => document.querySelectorAll(".crm-card-delete").length), 0);

    await anaPage.eval(`[...document.querySelectorAll(".crm-card")].find((x) => x.dataset.id === "c1").querySelector("[data-history]").click()`);
    const items = await anaPage.waitFor(() => {
      const li = [...document.querySelectorAll("#historicoLista li")].map((l) => l.textContent.replace(/\s+/g, " ").trim());
      return li.length >= 2 && li;
    });
    assert.match(items[0], /Ana Souza assumiu o caso/);
    assert.match(items.at(-1), /Bia Lima moveu de Novo caso para Documentos pendentes/);
    await anaPage.screenshot(path.join(SHOTS, "fase4-historico.png"));
    await anaPage.eval(() => document.getElementById("historicoClose").click());
  });

  test("nenhum erro de JavaScript nas duas telas", () => {
    assert.deepEqual(anaPage.errors, []);
    assert.deepEqual(biaPage.errors, []);
  });
});
