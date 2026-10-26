import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startServer, makeClient } from "./support/server.js";
import { launchBrowser, findChrome } from "./support/browser.js";
import { TEAM, EMERGENCY, EMERGENCY_ENV, teamRows, userRow, loginAs } from "./support/seed.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), "arcanjo-screens");
const noBrowser = findChrome() ? false : "nenhum Chrome/Edge encontrado (CHROME_PATH)";

async function page(client, url) {
  const res = await client.request(url);
  return { status: res.status, html: await res.text() };
}

async function sidOf(server, who) {
  const client = makeClient(server.url);
  await loginAs(client, who);
  return client.jar.get("connect.sid");
}

test("todos os scripts de public/js têm sintaxe válida", () => {
  const dir = path.join(ROOT, "public/js");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", path.join(dir, file)]);
  }
});

describe("layout por papel (HTML)", () => {
  let server;
  before(async () => {
    const xss = userRow({ id: "u-xss", name: "<img src=x onerror=alert(1)></script>", email: "xss@x.com", password: "senha-do-xss" });
    server = await startServer({ env: EMERGENCY_ENV, db: { users: [...teamRows(), xss] } });
  });
  after(() => server.stop());

  test("admin vê Usuários e Configurações, e o próprio nome no rodapé", async () => {
    const ana = makeClient(server.url);
    await loginAs(ana, TEAM.ana);
    const { html } = await page(ana, "/dashboard/conversas");
    assert.match(html, /href="\/dashboard\/usuarios"/);
    assert.match(html, /href="\/dashboard\/configuracoes"/);
    assert.match(html, /class="name">Ana Souza</);
    assert.match(html, />Administrador</);
    assert.match(html, /window\.Dash = \{ me: \{"id":"u-ana"/);
    assert.match(html, /id="accountForm"/);
    assert.doesNotMatch(html, /dash-emergency-banner/);
  });

  test("atendente não vê Usuários nem Configurações e recebe 403 no layout", async () => {
    const bia = makeClient(server.url);
    await loginAs(bia, TEAM.bia);
    const { html } = await page(bia, "/dashboard/crm");
    assert.doesNotMatch(html, /href="\/dashboard\/usuarios"/);
    assert.doesNotMatch(html, /href="\/dashboard\/configuracoes"/);
    assert.match(html, />Atendente</);

    const forbidden = await page(bia, "/dashboard/usuarios");
    assert.equal(forbidden.status, 403);
    assert.match(forbidden.html, /restrita a administradores/);
    assert.match(forbidden.html, /dash-sidebar/);
  });

  test("acesso de emergência mostra a faixa de aviso e não oferece troca de senha", async () => {
    const em = makeClient(server.url);
    await loginAs(em, EMERGENCY);
    const { html } = await page(em, "/dashboard/usuarios");
    assert.match(html, /dash-emergency-banner/);
    assert.match(html, /Acesso de emergência/);
    assert.doesNotMatch(html, /id="accountForm"/);
  });

  test("nome com HTML é escapado no layout e no JSON embutido", async () => {
    const client = makeClient(server.url);
    await loginAs(client, { email: "xss@x.com", password: "senha-do-xss" });
    const { html } = await page(client, "/dashboard/crm");
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x/);
    assert.doesNotMatch(html, /"name":"<img/);
    assert.match(html, /"name":"\\u003cimg/);
    // o "</script>" do nome não pode fechar a tag do JSON embutido
    assert.equal((html.match(/<\/script>/g) || []).length, (html.match(/<script/g) || []).length);
  });
});

describe("telas no navegador", { skip: noBrowser }, () => {
  let server;
  let browser;
  // Usuário só destes testes (o Caio tem a senha redefinida no primeiro teste).
  const GIL = { id: "u-gil", name: "Gil Prado", email: "gil@escritorio.com", password: "senha-do-gil" };
  before(async () => {
    server = await startServer({ env: EMERGENCY_ENV, db: { users: [...teamRows(), userRow(GIL)] } });
    browser = await launchBrowser();
  });
  after(async () => {
    await browser?.close();
    await server?.stop();
  });

  test("admin gerencia usuários pela tela (criar, desativar, redefinir senha)", async () => {
    const p = await browser.newPage(server.url);
    await p.login(await sidOf(server, TEAM.ana));
    await p.goto("/dashboard/usuarios");
    await p.waitFor(() => document.querySelectorAll("#usuariosTbody tr").length === 5);
    await p.screenshot(path.join(SHOTS, "fase3-usuarios.png"));

    // criar
    await p.eval(() => document.getElementById("btnNovoUsuario").click());
    await p.waitFor(() => document.getElementById("usuarioOverlay").classList.contains("open"));
    await p.screenshot(path.join(SHOTS, "fase3-novo-usuario.png"));
    await p.eval(() => {
      document.getElementById("usuarioNome").value = "Eva Nunes";
      document.getElementById("usuarioEmail").value = "eva@escritorio.com";
      document.getElementById("usuarioPapel").value = "atendente";
      document.getElementById("usuarioSenha").value = "senha-da-eva";
      document.getElementById("usuarioSalvar").click();
    });
    await p.waitFor(() => document.querySelectorAll("#usuariosTbody tr").length === 6);
    assert.ok(server.readDb().users.some((u) => u.email === "eva@escritorio.com"));

    // e-mail repetido mostra o erro no modal
    await p.eval(() => document.getElementById("btnNovoUsuario").click());
    await p.eval(() => {
      document.getElementById("usuarioNome").value = "Outra Eva";
      document.getElementById("usuarioEmail").value = "eva@escritorio.com";
      document.getElementById("usuarioSenha").value = "12345678";
      document.getElementById("usuarioSalvar").click();
    });
    const err = await p.waitFor(() => {
      const el = document.getElementById("usuarioErro");
      return el.style.display === "block" && el.textContent;
    });
    assert.match(err, /Já existe um usuário com esse e-mail/);
    await p.eval(() => document.querySelector("#usuarioOverlay [data-close]").click());

    // desativar (confirm é aceito automaticamente)
    await p.eval(() => document.querySelector('button[data-action="deactivate"][data-id="u-bia"]').click());
    await p.waitFor(() => document.querySelector('button[data-action="activate"][data-id="u-bia"]'));
    assert.equal(server.readDb().users.find((u) => u.id === "u-bia").active, false);
    assert.match(p.dialogs.at(-1), /Desativar Bia Lima/);

    // a própria linha não tem Desativar/Excluir
    assert.equal(await p.eval(() => document.querySelectorAll('[data-id="u-ana"][data-action="deactivate"], [data-id="u-ana"][data-action="delete"]').length), 0);

    // redefinir senha
    await p.eval(() => document.querySelector('button[data-action="password"][data-id="u-caio"]').click());
    await p.eval(() => {
      document.getElementById("senhaNova").value = "nova-senha-caio";
      document.getElementById("senhaSalvar").click();
    });
    await p.waitFor(() => !document.getElementById("senhaOverlay").classList.contains("open"));
    await loginAs(makeClient(server.url), { email: TEAM.caio.email, password: "nova-senha-caio" });

    assert.deepEqual(p.errors, []);
    assert.equal(p.httpErrors.length, 1); // só o 409 do e-mail repetido, provocado acima
    assert.match(p.httpErrors[0], /409/);
  });

  test("qualquer usuário troca a própria senha pelo modal Minha conta", async () => {
    const p = await browser.newPage(server.url);
    await p.login(await sidOf(server, { email: "eva@escritorio.com", password: "senha-da-eva" }));
    await p.goto("/dashboard/contatos");
    await p.eval(() => document.getElementById("dashUserChip").click());
    await p.waitFor(() => document.getElementById("accountOverlay").classList.contains("open"));

    await p.eval(() => {
      document.getElementById("accountCurrent").value = "errada-123";
      document.getElementById("accountNew").value = "senha-nova-eva";
      document.getElementById("accountConfirm").value = "senha-nova-eva";
      document.getElementById("accountSave").click();
    });
    assert.match(await p.waitFor(() => document.getElementById("accountError").style.display === "block" && document.getElementById("accountError").textContent), /Senha atual incorreta/);

    await p.eval(() => {
      document.getElementById("accountCurrent").value = "senha-da-eva";
      document.getElementById("accountSave").click();
    });
    await p.waitFor(() => document.getElementById("accountSuccess").style.display === "block");
    await p.screenshot(path.join(SHOTS, "fase3-minha-conta.png"));
    await loginAs(makeClient(server.url), { email: "eva@escritorio.com", password: "senha-nova-eva" });
    assert.deepEqual(p.errors, []);
    assert.equal(p.httpErrors.length, 1); // só o 403 da senha atual errada
  });

  test("telas do atendente carregam sem erro e sem os itens de admin", async () => {
    const p = await browser.newPage(server.url);
    await p.login(await sidOf(server, GIL));
    for (const url of ["/dashboard/crm", "/dashboard/conversas", "/dashboard/contatos", "/dashboard/canais"]) {
      await p.goto(url);
      const nav = await p.eval(() => [...document.querySelectorAll(".dash-nav a")].map((a) => a.textContent.trim()));
      assert.deepEqual(nav, ["Dashboard", "Conversas", "Contatos", "Canais"], url);
    }
    await p.goto("/dashboard/crm");
    await p.screenshot(path.join(SHOTS, "fase3-crm-atendente.png"));
    assert.deepEqual(p.errors, []);
  });

  test("sessão derrubada leva de volta ao login na próxima ação", async () => {
    const p = await browser.newPage(server.url);
    await p.login(await sidOf(server, GIL));
    await p.goto("/dashboard/contatos");
    const ana = makeClient(server.url);
    await loginAs(ana, TEAM.ana);
    await ana.request(`/api/users/${GIL.id}`, { method: "PATCH", json: { active: false } });
    await p.goto("/dashboard/contatos");
    assert.match(await p.eval("location.pathname"), /\/login$/);
  });
});
