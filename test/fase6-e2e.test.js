/**
 * Fluxo completo com 3 funcionários ao mesmo tempo (Ana admin, Bia e Caio
 * atendentes), 3 clientes no WhatsApp, envio "real" contra uma Graph API
 * falsa — para conferir quem recebeu o quê, sem mistura entre conversas.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startServer, makeClient, until } from "./support/server.js";
import { sseReader } from "./support/sse.js";
import { webhook, startFakeGraph, APP_SECRET } from "./support/whatsapp.js";
import { launchBrowser, findChrome } from "./support/browser.js";
import { TEAM, EMERGENCY_ENV, teamRows, loginAs } from "./support/seed.js";

const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "arcanjo-screens");
const noBrowser = findChrome() ? false : "nenhum Chrome/Edge encontrado (CHROME_PATH)";

const CLIENTS = {
  ana: { phone: "5511910000001", first: "Fui demitido sem receber as verbas rescisórias" },
  bia: { phone: "5511910000002", first: "Meu salário está atrasado há dois meses" },
  caio: { phone: "5511910000003", first: "Oi, bom dia" },
};

describe("3 funcionários atendendo 3 clientes ao mesmo tempo", () => {
  let graph;
  let server;
  let wa;
  const staff = {}; // nome -> { client, crm, conv }

  const sessionOf = (phone) => server.readDb().sessions.find((s) => s.phone === phone);
  const caseOf = (phone) => server.readDb().crm_cases.find((c) => c.phone === phone);
  const sentTo = (phone) => graph.sends().filter((r) => r.body.to === phone);

  before(async () => {
    graph = await startFakeGraph();
    server = await startServer({
      env: {
        ...EMERGENCY_ENV,
        WHATSAPP_APP_SECRET: APP_SECRET,
        WHATSAPP_SEND_ENABLED: "true",
        WHATSAPP_TOKEN: "token-de-teste",
        WHATSAPP_PHONE_NUMBER_ID: "123456",
        WHATSAPP_GRAPH_URL: graph.url,
      },
      db: { users: teamRows() },
    });
    wa = webhook(server);
    for (const name of ["ana", "bia", "caio"]) {
      const client = makeClient(server.url);
      await loginAs(client, TEAM[name]);
      staff[name] = {
        client,
        crm: sseReader(await client.request("/api/crm/stream")),
        conv: sseReader(await client.request("/api/conversas/stream")),
      };
    }
  });
  after(async () => {
    for (const s of Object.values(staff)) {
      s.crm.close();
      s.conv.close();
    }
    await server?.stop();
    await graph?.close();
  });

  test("1. três clientes escrevem juntos: a IA responde cada um e cria os casos", async () => {
    await Promise.all(Object.values(CLIENTS).map((c) => wa.text(c.phone, c.first)));
    for (const c of Object.values(CLIENTS)) {
      await until(() => sentTo(c.phone).length === 1, { what: `a resposta da IA para ${c.phone}` });
      assert.equal(sentTo(c.phone)[0].body.text.body, `Resposta da IA para: ${c.first}`);
    }
    // casos criados pela IA para quem descreveu um problema (não para o "bom dia")
    await until(() => caseOf(CLIENTS.ana.phone) && caseOf(CLIENTS.bia.phone), { what: "os casos" });
    assert.equal(caseOf(CLIENTS.caio.phone), undefined);
    for (const s of Object.values(staff)) {
      for (const phone of [CLIENTS.ana.phone, CLIENTS.bia.phone]) {
        await s.crm.waitFor((e) => e.data.type === "created" && e.data.case.phone === phone);
      }
    }
  });

  test("2. cada um assume uma conversa, pega o caso e move no Kanban — tudo ao mesmo tempo", async () => {
    const caseAna = caseOf(CLIENTS.ana.phone).id;
    const caseBia = caseOf(CLIENTS.bia.phone).id;
    const results = await Promise.all([
      staff.ana.client.request(`/api/conversas/${sessionOf(CLIENTS.ana.phone).id}/assume`, { method: "POST", json: {} }),
      staff.bia.client.request(`/api/conversas/${sessionOf(CLIENTS.bia.phone).id}/assume`, { method: "POST", json: {} }),
      staff.caio.client.request(`/api/conversas/${sessionOf(CLIENTS.caio.phone).id}/assume`, { method: "POST", json: {} }),
      staff.ana.client.request(`/api/crm/cases/${caseAna}/assign`, { method: "PATCH", json: { userId: TEAM.ana.id } }),
      staff.bia.client.request(`/api/crm/cases/${caseBia}/assign`, { method: "PATCH", json: { userId: TEAM.bia.id } }),
      staff.ana.client.request(`/api/crm/cases/${caseAna}/status`, { method: "PATCH", json: { status: "Em análise" } }),
      staff.bia.client.request(`/api/crm/cases/${caseBia}/status`, { method: "PATCH", json: { status: "Documentos pendentes" } }),
    ]);
    results.forEach((r) => assert.equal(r.status, 200));

    for (const [name, c] of Object.entries(CLIENTS)) {
      const s = sessionOf(c.phone);
      assert.equal(s.ai_paused, true);
      assert.equal(s.handler_user_id, TEAM[name].id);
    }
    const db = server.readDb();
    assert.equal(db.crm_cases.find((c) => c.id === caseAna).assigned_to, TEAM.ana.id);
    assert.equal(db.crm_cases.find((c) => c.id === caseAna).status_changed_by_name, "Ana Souza");
    assert.equal(db.crm_cases.find((c) => c.id === caseBia).status, "Documentos pendentes");

    // os três quadros recebem as mesmas mudanças, com os autores certos
    for (const s of Object.values(staff)) {
      const moveAna = await s.crm.waitFor((e) => e.data.type === "moved" && e.data.caseId === caseAna);
      const moveBia = await s.crm.waitFor((e) => e.data.type === "moved" && e.data.caseId === caseBia);
      assert.equal(moveAna.data.actor.name, "Ana Souza");
      assert.equal(moveBia.data.actor.name, "Bia Lima");
      // e as três conversas aparecem como "em atendimento" para todo mundo
      for (const [name, c] of Object.entries(CLIENTS)) {
        await s.conv.waitFor((e) => e.event === "session" && e.data.session.phone === c.phone && e.data.session.handler_user_id === TEAM[name].id);
      }
    }
  });

  test("3. cada um responde o seu cliente: ninguém recebe mensagem de outra conversa", async () => {
    const texts = { ana: "Aqui é a Ana, vou analisar sua rescisão.", bia: "Aqui é a Bia, me mande os holerites.", caio: "Aqui é o Caio, como posso ajudar?" };
    const results = await Promise.all(
      Object.entries(CLIENTS).map(([name, c]) =>
        staff[name].client.request(`/api/conversas/${sessionOf(c.phone).id}/messages`, { method: "POST", json: { content: texts[name] } })
      )
    );
    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal((await r.json()).data.delivery_status, "sent");
    }
    for (const [name, c] of Object.entries(CLIENTS)) {
      const bodies = sentTo(c.phone).map((r) => r.body.text.body);
      assert.deepEqual(bodies, [`Resposta da IA para: ${c.first}`, texts[name]]);
    }
  });

  test("4. com a IA pausada, novas mensagens dos clientes não recebem resposta automática", async () => {
    await Promise.all(Object.values(CLIENTS).map((c) => wa.text(c.phone, "Obrigado!")));
    await until(() => Object.values(CLIENTS).every((c) => server.readDb().messages.filter((m) => m.session_id === sessionOf(c.phone).id && m.content === "Obrigado!").length === 1), { what: "as mensagens" });
    await new Promise((r) => setTimeout(r, 500));
    for (const c of Object.values(CLIENTS)) assert.equal(sentTo(c.phone).length, 2);
  });

  test("5. ninguém responde o cliente de outra pessoa sem confirmar", async () => {
    const res = await staff.caio.client.request(`/api/conversas/${sessionOf(CLIENTS.ana.phone).id}/messages`, { method: "POST", json: { content: "Oi" } });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).handler.name, "Ana Souza");
    assert.equal(sentTo(CLIENTS.ana.phone).length, 2);
  });

  test("6. histórico com a autoria de cada um", () => {
    const events = server.readDb().case_events;
    const byType = (type, userId) => events.filter((e) => e.type === type && e.user_id === userId).length;
    assert.equal(byType("ai_paused", TEAM.ana.id), 1);
    assert.equal(byType("ai_paused", TEAM.bia.id), 1);
    assert.equal(byType("ai_paused", TEAM.caio.id), 1);
    assert.equal(byType("moved", TEAM.ana.id), 1);
    assert.equal(byType("moved", TEAM.bia.id), 1);
    assert.equal(events.filter((e) => e.type === "created" && e.actor_name === "IA (classificação)").length, 2);
    assert.ok(!events.some((e) => (e.type === "moved" || e.type === "assigned") && !e.user_id), "a IA nunca move nem atribui");
  });

  test("7. devolvendo à IA, ela volta a responder", async () => {
    await Promise.all(
      Object.entries(CLIENTS).map(([name, c]) =>
        staff[name].client.request(`/api/conversas/${sessionOf(c.phone).id}/release`, { method: "POST" })
      )
    );
    await Promise.all(Object.values(CLIENTS).map((c) => wa.text(c.phone, "Mais uma dúvida")));
    for (const c of Object.values(CLIENTS)) {
      await until(() => sentTo(c.phone).length === 3, { what: `a IA responder ${c.phone}` });
      assert.equal(sentTo(c.phone)[2].body.text.body, "Resposta da IA para: Mais uma dúvida");
    }
  });
});

test("scripts/simular-mensagem.js entrega uma mensagem assinada ao webhook", async () => {
  const server = await startServer({ env: { ...EMERGENCY_ENV, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_SIMULATE: "true" }, db: { users: teamRows() } });
  try {
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/simular-mensagem.js");
    const out = execFileSync(process.execPath, [script, "+55 (11) 93000-0000", "Olá, sou um teste", "--nome", "Maria", "--url", server.url], {
      cwd: os.tmpdir(), // sem .env de quem roda os testes
      env: { ...process.env, WHATSAPP_APP_SECRET: APP_SECRET },
    }).toString();
    assert.match(out, /entregue ao webhook/);
    await until(() => server.readDb().messages?.some((m) => m.content === "Resposta da IA para: Olá, sou um teste" && m.delivery_status === "sent"), { what: "a resposta simulada" });
    assert.equal(server.readDb().sessions[0].phone, "5511930000000");
  } finally {
    await server.stop();
  }
});

describe("3 quadros do Kanban no navegador ao mesmo tempo", { skip: noBrowser }, () => {
  let server;
  let browser;
  const pages = {};
  const t = (min) => new Date(Date.now() - min * 60000).toISOString();

  before(async () => {
    server = await startServer({
      env: EMERGENCY_ENV,
      db: {
        users: teamRows(),
        crm_cases: [
          { id: "k1", phone: "5511920000001", client_name: "Cliente Um", status: "Novo caso", urgency_tag: "Alta", updated_at: t(1) },
          { id: "k2", phone: "5511920000002", client_name: "Cliente Dois", status: "Novo caso", urgency_tag: "Normal", updated_at: t(2) },
          { id: "k3", phone: "5511920000003", client_name: "Cliente Três", status: "Novo caso", urgency_tag: "Baixa", updated_at: t(3) },
        ],
      },
    });
    browser = await launchBrowser();
    for (const name of ["ana", "bia", "caio"]) {
      const client = makeClient(server.url);
      await loginAs(client, TEAM[name]);
      const page = await browser.newPage(server.url);
      await page.login(client.jar.get("connect.sid"));
      await page.goto("/dashboard/crm");
      await page.waitFor(() => document.querySelectorAll(".crm-card").length === 3 && document.getElementById("crmLive").dataset.state === "on");
      pages[name] = page;
    }
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test("cada um arrasta um card diferente no mesmo instante e os três quadros convergem", async () => {
    const drag = (page, id, status) =>
      page.eval(`(() => {
        const card = [...document.querySelectorAll(".crm-card")].find((c) => c.dataset.id === ${JSON.stringify(id)});
        const col = [...document.querySelectorAll(".crm-column")].find((c) => c.dataset.status === ${JSON.stringify(status)});
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        col.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        col.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
      })()`);
    const target = { k1: "Em análise", k2: "Documentos pendentes", k3: "Processo iniciado" };
    await Promise.all([drag(pages.ana, "k1", target.k1), drag(pages.bia, "k2", target.k2), drag(pages.caio, "k3", target.k3)]);

    const expected = JSON.stringify(target);
    for (const page of Object.values(pages)) {
      await page.waitFor(`(() => {
        const pos = {};
        document.querySelectorAll(".crm-card").forEach((c) => (pos[c.dataset.id] = c.closest(".crm-column").dataset.status));
        return JSON.stringify({ k1: pos.k1, k2: pos.k2, k3: pos.k3 }) === ${JSON.stringify(expected)};
      })()`);
    }
    const db = server.readDb().crm_cases;
    for (const [id, status] of Object.entries(target)) assert.equal(db.find((c) => c.id === id).status, status);

    // cada um vê o aviso das mudanças dos outros dois (e não da própria)
    const toastsOf = (page) => page.waitFor(() => document.querySelectorAll(".crm-toast").length >= 2 && [...document.querySelectorAll(".crm-toast")].map((t) => t.textContent));
    assert.ok((await toastsOf(pages.ana)).every((t) => !t.startsWith("Ana")));
    assert.ok((await toastsOf(pages.bia)).every((t) => !t.startsWith("Bia")));
    assert.ok((await toastsOf(pages.caio)).every((t) => !t.startsWith("Caio")));
    await pages.caio.screenshot(path.join(SHOTS, "fase6-tres-quadros.png"));

    for (const page of Object.values(pages)) assert.deepEqual(page.errors, []);
  });
});
