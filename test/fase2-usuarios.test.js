import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { startServer, makeClient } from "./support/server.js";
import { sseReader } from "./support/sse.js";
import { TEAM, EMERGENCY, EMERGENCY_ENV, teamRows, loginAs } from "./support/seed.js";

const baseDb = () => ({
  users: teamRows(),
  crm_cases: [{ id: "c1", phone: "5511999999999", client_name: "Cliente", status: "Novo caso" }],
});

async function me(client) {
  const res = await client.request("/api/me");
  return { status: res.status, body: res.status === 200 ? (await res.json()).data : null };
}

describe("login individual", () => {
  let server;
  before(async () => (server = await startServer({ env: EMERGENCY_ENV, db: baseDb() })));
  after(() => server.stop());

  test("e-mail (sem diferenciar maiúsculas) + senha; /api/me não expõe o hash", async () => {
    const client = makeClient(server.url);
    await client.request("/login", { method: "POST", form: { username: "  ANA@Escritorio.com ", password: TEAM.ana.password } });
    const { status, body } = await me(client);
    assert.equal(status, 200);
    assert.deepEqual(body, { id: "u-ana", name: "Ana Souza", email: "ana@escritorio.com", role: "admin" });
  });

  test("senha errada e usuário desativado não entram", async () => {
    const wrong = makeClient(server.url);
    const res = await wrong.request("/login", { method: "POST", form: { username: TEAM.bia.email, password: "errada" } });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /E-mail ou senha incorretos/);
    assert.equal((await me(wrong)).status, 401);

    const inactive = makeClient(server.url);
    const res2 = await inactive.request("/login", { method: "POST", form: { username: TEAM.duda.email, password: TEAM.duda.password } });
    assert.equal(res2.status, 200);
    assert.equal((await me(inactive)).status, 401);
  });

  test("acesso de emergência do .env continua funcionando", async () => {
    const client = makeClient(server.url);
    await loginAs(client, EMERGENCY);
    const { body } = await me(client);
    assert.equal(body.role, "admin");
    assert.equal(body.emergency, true);
    assert.equal(body.id, null);
    assert.match(server.logs(), /ACESSO DE EMERGÊNCIA/);
  });

  test("a sessão fica gravada em web_sessions com o user_id", async () => {
    const client = makeClient(server.url);
    await loginAs(client, TEAM.caio);
    const rows = server.readDb().web_sessions.filter((s) => s.user_id === "u-caio");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sess.user.email, "caio@escritorio.com");
    assert.ok(Date.parse(rows[0].expire) > Date.now());
  });

  test("logout apaga a sessão do banco", async () => {
    const client = makeClient(server.url);
    await loginAs(client, TEAM.caio);
    const before = server.readDb().web_sessions.length;
    await client.request("/logout");
    assert.equal(server.readDb().web_sessions.length, before - 1);
    assert.equal((await me(client)).status, 401);
  });
});

test("login sobrevive a um reinício do servidor (store no banco)", async () => {
  const first = await startServer({ env: EMERGENCY_ENV, db: baseDb() });
  const client = makeClient(first.url);
  await loginAs(client, TEAM.bia);
  const db = first.readDb();
  await first.stop();

  const second = await startServer({ env: EMERGENCY_ENV, db });
  try {
    const again = makeClient(second.url);
    again.jar.set("connect.sid", client.jar.get("connect.sid"));
    const { status, body } = await me(again);
    assert.equal(status, 200);
    assert.equal(body.id, "u-bia");
  } finally {
    await second.stop();
  }
});

describe("permissões por papel", () => {
  let server;
  let bia;
  let ana;
  before(async () => {
    server = await startServer({ env: EMERGENCY_ENV, db: baseDb() });
    bia = makeClient(server.url);
    ana = makeClient(server.url);
    await loginAs(bia, TEAM.bia);
    await loginAs(ana, TEAM.ana);
  });
  after(() => server.stop());

  test("atendente não gerencia usuários, não exclui casos e não muda a personalidade do bot", async () => {
    assert.equal((await bia.request("/api/users")).status, 403);
    assert.equal((await bia.request("/api/users", { method: "POST", json: { name: "X" } })).status, 403);
    assert.equal((await bia.request("/api/crm/cases/c1", { method: "DELETE" })).status, 403);
    assert.equal((await bia.request("/api/settings", { method: "POST", json: { systemPrompt: "x" } })).status, 403);
    assert.equal((await bia.request("/dashboard/configuracoes")).status, 403);
    assert.equal(server.readDb().crm_cases.length, 1);
  });

  test("atendente continua usando o resto do painel", async () => {
    assert.equal((await bia.request("/api/crm/cases")).status, 200);
    assert.equal((await bia.request("/api/conversas")).status, 200);
    assert.equal((await bia.request("/api/settings")).status, 200);
    const move = await bia.request("/api/crm/cases/c1/status", { method: "PATCH", json: { status: "Em análise" } });
    assert.equal(move.status, 200);
  });

  test("admin exclui caso", async () => {
    assert.equal((await ana.request("/api/crm/cases/c1", { method: "DELETE" })).status, 200);
    assert.equal(server.readDb().crm_cases.length, 0);
  });
});

describe("gestão de usuários (admin)", () => {
  let server;
  let ana;
  before(async () => {
    server = await startServer({ env: EMERGENCY_ENV, db: baseDb() });
    ana = makeClient(server.url);
    await loginAs(ana, TEAM.ana);
  });
  after(() => server.stop());

  test("lista sem expor hashes", async () => {
    const res = await ana.request("/api/users");
    const { data } = await res.json();
    assert.equal(data.length, 4);
    assert.ok(data.every((u) => !("password_hash" in u)));
  });

  test("cria usuário, que consegue entrar; valida e-mail repetido e senha curta", async () => {
    const res = await ana.request("/api/users", {
      method: "POST",
      json: { name: "Eva Nunes", email: "Eva@Escritorio.com", password: "senha-da-eva", role: "atendente" },
    });
    assert.equal(res.status, 201);
    const { data } = await res.json();
    assert.equal(data.email, "eva@escritorio.com");
    const stored = server.readDb().users.find((u) => u.id === data.id);
    assert.ok(await bcrypt.compare("senha-da-eva", stored.password_hash));

    const eva = makeClient(server.url);
    await loginAs(eva, { email: "eva@escritorio.com", password: "senha-da-eva" });
    assert.equal((await me(eva)).body.name, "Eva Nunes");

    const dup = await ana.request("/api/users", {
      method: "POST",
      json: { name: "Outra", email: "eva@escritorio.com", password: "12345678" },
    });
    assert.equal(dup.status, 409);
    const weak = await ana.request("/api/users", { method: "POST", json: { name: "Fê", email: "fe@x.com", password: "123" } });
    assert.equal(weak.status, 400);
    assert.match((await weak.json()).error, /pelo menos 8/);
  });

  test("desativar derruba a sessão e fecha o tempo real (SSE) da pessoa", async () => {
    const bia = makeClient(server.url);
    await loginAs(bia, TEAM.bia);
    const stream = sseReader(await bia.request("/api/conversas/stream"));

    const res = await ana.request(`/api/users/${TEAM.bia.id}`, { method: "PATCH", json: { active: false } });
    assert.equal(res.status, 200);
    await stream.waitEnd();
    assert.equal((await me(bia)).status, 401);
    assert.equal(server.readDb().web_sessions.filter((s) => s.user_id === TEAM.bia.id).length, 0);
  });

  test("trocar o papel derruba a sessão", async () => {
    const caio = makeClient(server.url);
    await loginAs(caio, TEAM.caio);
    await ana.request(`/api/users/${TEAM.caio.id}`, { method: "PATCH", json: { role: "admin" } });
    assert.equal((await me(caio)).status, 401);
    await loginAs(caio, TEAM.caio);
    assert.equal((await me(caio)).body.role, "admin");
  });

  test("renomear atualiza a sessão aberta sem derrubar", async () => {
    const caio = makeClient(server.url);
    await loginAs(caio, TEAM.caio);
    await ana.request(`/api/users/${TEAM.caio.id}`, { method: "PATCH", json: { name: "Caio R." } });
    const { status, body } = await me(caio);
    assert.equal(status, 200);
    assert.equal(body.name, "Caio R.");
  });

  test("redefinir senha derruba a sessão; a senha nova vale e a antiga não", async () => {
    const caio = makeClient(server.url);
    await loginAs(caio, TEAM.caio);
    const res = await ana.request(`/api/users/${TEAM.caio.id}/password`, { method: "POST", json: { password: "nova-senha-caio" } });
    assert.equal(res.status, 200);
    assert.equal((await me(caio)).status, 401);
    await assert.rejects(loginAs(makeClient(server.url), TEAM.caio));
    await loginAs(caio, { email: TEAM.caio.email, password: "nova-senha-caio" });
  });

  test("admin não se desativa nem se rebaixa", async () => {
    const res = await ana.request(`/api/users/${TEAM.ana.id}`, { method: "PATCH", json: { role: "atendente" } });
    assert.equal(res.status, 409);
    const res2 = await ana.request(`/api/users/${TEAM.ana.id}`, { method: "PATCH", json: { active: false } });
    assert.equal(res2.status, 409);
  });

  test("sempre sobra um admin ativo (mesmo pelo acesso de emergência)", async () => {
    // Caio virou admin num teste acima; volta a atendente para Ana ser a única.
    await ana.request(`/api/users/${TEAM.caio.id}`, { method: "PATCH", json: { role: "atendente" } });
    const emergency = makeClient(server.url);
    await loginAs(emergency, EMERGENCY);
    const res = await emergency.request(`/api/users/${TEAM.ana.id}`, { method: "PATCH", json: { active: false } });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /pelo menos um administrador/);
  });

  test("excluir só quem não tem histórico", async () => {
    const db = server.readDb();
    db.case_events = [{ id: "e1", case_id: "c1", user_id: TEAM.duda.id, actor_name: "Duda", type: "moved" }];
    server.writeDb(db);
    const blocked = await ana.request(`/api/users/${TEAM.duda.id}`, { method: "DELETE" });
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /desative-o/);

    const created = await (await ana.request("/api/users", {
      method: "POST",
      json: { name: "Engano", email: "engano@x.com", password: "12345678" },
    })).json();
    const ok = await ana.request(`/api/users/${created.data.id}`, { method: "DELETE" });
    assert.equal(ok.status, 200);
    assert.ok(!server.readDb().users.some((u) => u.id === created.data.id));
  });
});

describe("trocar a própria senha", () => {
  let server;
  before(async () => (server = await startServer({ env: EMERGENCY_ENV, db: baseDb() })));
  after(() => server.stop());

  test("mantém a sessão atual e derruba as outras", async () => {
    const pc = makeClient(server.url);
    const celular = makeClient(server.url);
    await loginAs(pc, TEAM.bia);
    await loginAs(celular, TEAM.bia);

    const wrong = await pc.request("/api/me/password", { method: "PUT", json: { currentPassword: "errada", newPassword: "nova-senha-bia" } });
    assert.equal(wrong.status, 403);

    const res = await pc.request("/api/me/password", {
      method: "PUT",
      json: { currentPassword: TEAM.bia.password, newPassword: "nova-senha-bia" },
    });
    assert.equal(res.status, 200);
    assert.equal((await me(pc)).status, 200);
    assert.equal((await me(celular)).status, 401);
  });

  test("acesso de emergência não troca senha pelo painel", async () => {
    const client = makeClient(server.url);
    await loginAs(client, EMERGENCY);
    const res = await client.request("/api/me/password", { method: "PUT", json: { currentPassword: "x", newPassword: "12345678" } });
    assert.equal(res.status, 400);
  });

  test("tentativas erradas da senha atual são limitadas", async () => {
    const client = makeClient(server.url);
    await loginAs(client, TEAM.caio);
    for (let i = 0; i < 5; i++) {
      await client.request("/api/me/password", { method: "PUT", json: { currentPassword: "errada", newPassword: "12345678" } });
    }
    const res = await client.request("/api/me/password", {
      method: "PUT",
      json: { currentPassword: TEAM.caio.password, newPassword: "12345678" },
    });
    assert.equal(res.status, 429);
  });
});
