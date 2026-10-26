/**
 * Sobe o servidor de verdade (src/server.js) em um processo filho, com o
 * Supabase falso, numa porta livre e com cwd numa pasta temporária — assim o
 * dotenv não lê o .env de quem está rodando os testes.
 */
import { spawn } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_PATH = path.join(ROOT, "src/server.js");
const REGISTER_URL = pathToFileURL(path.join(ROOT, "test/support/register.mjs")).href;

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function baseEnv() {
  // Só o mínimo do ambiente do sistema (Windows precisa de SystemRoot).
  const keep = ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"];
  const env = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/** Inicia o processo do servidor sem esperar ele ficar pronto. */
export async function spawnServer({ env = {}, db = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanjo-test-"));
  const dbFile = path.join(dir, "db.json");
  fs.writeFileSync(dbFile, JSON.stringify(db));
  const port = await freePort();

  const child = spawn(process.execPath, ["--import", REGISTER_URL, SERVER_PATH], {
    cwd: dir,
    env: {
      ...baseEnv(),
      SUPABASE_URL: "http://fake.supabase.local",
      SUPABASE_KEY: "fake-key",
      FAKE_DB_FILE: dbFile,
      PORT: String(port),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));

  return {
    url: `http://127.0.0.1:${port}`,
    child,
    exited,
    logs: () => output,
    readDb: () => JSON.parse(fs.readFileSync(dbFile, "utf8")),
    writeDb: (data) => fs.writeFileSync(dbFile, JSON.stringify(data)),
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Inicia o servidor e espera ele responder em /login. */
export async function startServer(opts) {
  const server = await spawnServer(opts);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Servidor saiu com código ${server.child.exitCode}:\n${server.logs()}`);
    }
    try {
      const res = await fetch(`${server.url}/login`);
      if (res.ok) return server;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await server.stop();
  throw new Error(`Servidor não respondeu a tempo:\n${server.logs()}`);
}

/** Cliente HTTP com "pote" de cookies, sem seguir redirecionamentos. */
export function makeClient(baseUrl, defaultHeaders = {}) {
  const jar = new Map();

  async function request(urlPath, { method = "GET", headers = {}, form, json, body } = {}) {
    const h = { ...defaultHeaders, ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload = body;
    if (form) {
      payload = new URLSearchParams(form).toString();
      h["content-type"] = "application/x-www-form-urlencoded";
    }
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h["content-type"] = "application/json";
    }
    const res = await fetch(baseUrl + urlPath, { method, headers: h, body: payload, redirect: "manual" });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }

  return { request, jar };
}
