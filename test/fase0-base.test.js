import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { spawnServer, startServer, makeClient } from "./support/server.js";
import { loginRetryAfterMs, registerLoginFailure, clearLoginFailures } from "../src/utils/loginLimiter.js";
import eventBus from "../src/utils/events.js";

const PASSWORD = "senha-certa";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const LOGIN_ENV = { ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: PASSWORD_HASH };
const PROD_ENV = { ...LOGIN_ENV, NODE_ENV: "production", SESSION_SECRET: "segredo-de-teste" };

async function login(client, password = PASSWORD, username = "admin") {
  return client.request("/login", { method: "POST", form: { username, password } });
}

describe("SESSION_SECRET em produção", () => {
  test("servidor se recusa a subir sem SESSION_SECRET", async () => {
    const server = await spawnServer({ env: { ...LOGIN_ENV, NODE_ENV: "production" } });
    const code = await server.exited;
    await server.stop();
    assert.equal(code, 1);
    assert.match(server.logs(), /SESSION_SECRET não configurado/);
  });

  test("valor padrão antigo também é recusado", async () => {
    const server = await spawnServer({
      env: { ...LOGIN_ENV, NODE_ENV: "production", SESSION_SECRET: "troque-este-segredo-no-env" },
    });
    assert.equal(await server.exited, 1);
    await server.stop();
  });
});

describe("cookie de sessão em produção atrás de proxy", () => {
  let server;
  before(async () => (server = await startServer({ env: PROD_ENV })));
  after(() => server.stop());

  test("proxy informa https: cookie Secure e login funciona", async () => {
    const client = makeClient(server.url, { "x-forwarded-proto": "https" });
    const res = await login(client);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/dashboard");
    const [cookie] = res.headers.getSetCookie();
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);

    const page = await client.request("/dashboard/conversas");
    assert.equal(page.status, 200);
  });

  test("proxy informa http: login NÃO entra em loop e o log avisa", async () => {
    const client = makeClient(server.url, { "x-forwarded-proto": "http" });
    const res = await login(client);
    assert.equal(res.status, 302);
    const [cookie] = res.headers.getSetCookie();
    assert.ok(cookie, "o cookie de sessão precisa ser gravado");
    assert.doesNotMatch(cookie, /; Secure/);

    const page = await client.request("/dashboard/conversas");
    assert.equal(page.status, 200);
    assert.match(server.logs(), /Requisição chegou como HTTP em produção/);
  });

  test("sem login, o painel redireciona para /login e a API responde 401", async () => {
    const client = makeClient(server.url, { "x-forwarded-proto": "https" });
    const page = await client.request("/dashboard/conversas");
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/login");
    const api = await client.request("/api/conversas");
    assert.equal(api.status, 401);
  });

  test("login troca o id da sessão (contra fixação de sessão)", async () => {
    const client = makeClient(server.url, { "x-forwarded-proto": "https" });
    await login(client, "errada"); // não cria sessão (saveUninitialized: false)
    await login(client);
    const firstSid = client.jar.get("connect.sid");
    await login(client);
    assert.notEqual(client.jar.get("connect.sid"), firstSid);
  });
});

describe("COOKIE_SECURE=true com proxy informando http", () => {
  let server;
  before(async () => (server = await startServer({ env: { ...PROD_ENV, COOKIE_SECURE: "true" } })));
  after(() => server.stop());

  test("cookie não é gravado (comportamento antigo) e o log explica por quê", async () => {
    const client = makeClient(server.url, { "x-forwarded-proto": "http" });
    const res = await login(client);
    assert.equal(res.headers.getSetCookie().length, 0);
    assert.match(server.logs(), /COOKIE_SECURE=true o cookie de login NÃO é gravado/);
  });
});

describe("webhook do WhatsApp", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sign = (secret, payload) =>
    "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

  test("sem WHATSAPP_APP_SECRET recusa com 503", async () => {
    const server = await startServer({ env: LOGIN_ENV });
    try {
      const res = await fetch(`${server.url}/webhook/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      assert.equal(res.status, 503);
      assert.match(server.logs(), /WHATSAPP_APP_SECRET não configurado/);
    } finally {
      await server.stop();
    }
  });

  test("com secret: assinatura errada dá 401, certa dá 200", async () => {
    const server = await startServer({ env: { ...LOGIN_ENV, WHATSAPP_APP_SECRET: "app-secret" } });
    try {
      const post = (signature) =>
        fetch(`${server.url}/webhook/whatsapp`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-hub-signature-256": signature },
          body,
        });
      assert.equal((await post(sign("outro-secret", body))).status, 401);
      assert.equal((await post(sign("app-secret", body))).status, 200);
    } finally {
      await server.stop();
    }
  });
});

describe("limite de tentativas de login", () => {
  let server;
  before(async () => (server = await startServer({ env: LOGIN_ENV })));
  after(() => server.stop());

  test("5 erros bloqueiam o usuário naquele IP, mesmo com a senha certa", async () => {
    const client = makeClient(server.url);
    for (let i = 0; i < 5; i++) {
      const res = await login(client, "errada");
      assert.equal(res.status, 200);
    }
    const blocked = await login(client);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.match(await blocked.text(), /Muitas tentativas de login/);
  });

  test("outro usuário no mesmo IP continua podendo tentar", async () => {
    const client = makeClient(server.url);
    const res = await login(client, "errada", "outro");
    assert.equal(res.status, 200);
  });
});

describe("limitador (unidade)", () => {
  test("bloqueio por IP+usuário expira após a janela e o acerto zera o contador", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) registerLoginFailure("10.0.0.1", "Ana", t0);
    assert.ok(loginRetryAfterMs("10.0.0.1", " ana ", t0) > 0, "normaliza o usuário");
    assert.equal(loginRetryAfterMs("10.0.0.1", "ana", t0 + 15 * 60 * 1000), 0);

    for (let i = 0; i < 4; i++) registerLoginFailure("10.0.0.2", "bia", t0);
    clearLoginFailures("10.0.0.2", "bia");
    registerLoginFailure("10.0.0.2", "bia", t0);
    assert.equal(loginRetryAfterMs("10.0.0.2", "bia", t0), 0);
  });

  test("20 erros no mesmo IP bloqueiam qualquer usuário daquele IP", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 20; i++) registerLoginFailure("10.0.0.3", `user${i}`, t0);
    assert.ok(loginRetryAfterMs("10.0.0.3", "novo", t0) > 0);
    assert.equal(loginRetryAfterMs("10.0.0.4", "novo", t0), 0);
  });
});

test("eventBus aceita várias conexões SSE sem aviso de vazamento", () => {
  assert.ok(eventBus.getMaxListeners() >= 100);
});
