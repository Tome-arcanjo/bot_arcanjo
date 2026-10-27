/**
 * Navegador de verdade para os testes de tela: Chrome/Edge headless
 * controlado pelo DevTools Protocol, usando o WebSocket nativo do Node 22
 * (sem puppeteer/playwright). Se nenhum navegador for encontrado, os testes
 * de tela são pulados (CHROME_PATH aponta um executável específico).
 *
 * Cada `newPage()` abre um contexto isolado (cookies próprios), então dá para
 * ter vários usuários logados ao mesmo tempo.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { freePort } from "./server.js";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function findChrome() {
  return CANDIDATES.find((p) => p && fs.existsSync(p)) || null;
}

// Erros de console que não são do app (ex: fonte do Google sem internet).
const IGNORED_ERRORS = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /favicon\.ico/];

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.data || ""})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.handlers.get(msg.method) || []) fn(msg.params);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP: tempo esgotado esperando ${method}`)), timeoutMs);
      const fn = (params) => {
        clearTimeout(timer);
        this.handlers.set(method, (this.handlers.get(method) || []).filter((f) => f !== fn));
        resolve(params);
      };
      this.on(method, fn);
    });
  }

  close() {
    this.ws.close();
  }
}

class Page {
  constructor(cdp, baseUrl) {
    this.cdp = cdp;
    this.baseUrl = baseUrl;
    this.errors = []; // erros de JavaScript (exceções e console.error)
    this.httpErrors = []; // respostas HTTP com erro
    this.dialogs = [];
  }

  async init() {
    const { cdp } = this;
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Log.enable"), cdp.send("Network.enable")]);
    cdp.on("Runtime.exceptionThrown", (p) =>
      this.recordError(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)
    );
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") this.recordError(p.args.map((a) => a.value ?? a.description).join(" "));
    });
    cdp.on("Log.entryAdded", (p) => {
      if (p.entry.level !== "error") return;
      // Respostas 4xx/5xx viram "Failed to load resource" no console. Ficam
      // separadas: muitos testes provocam um 409/403 de propósito.
      if (p.entry.source === "network") this.httpErrors.push(`${p.entry.text} ${p.entry.url || ""}`);
      else this.recordError(`${p.entry.text} ${p.entry.url || ""}`);
    });
    // confirm()/alert() são aceitos automaticamente e registrados.
    cdp.on("Page.javascriptDialogOpening", (p) => {
      this.dialogs.push(p.message);
      cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    });
  }

  recordError(text) {
    if (!IGNORED_ERRORS.some((re) => re.test(text))) this.errors.push(text);
  }

  async login(sidCookie) {
    await this.cdp.send("Network.setCookie", { name: "connect.sid", value: sidCookie, url: this.baseUrl });
  }

  async goto(urlPath) {
    const loaded = this.cdp.once("Page.loadEventFired");
    await this.cdp.send("Page.navigate", { url: this.baseUrl + urlPath });
    await loaded;
  }

  /** Avalia uma expressão (ou função sem argumentos) na página e devolve o valor. */
  async eval(expression) {
    const expr = typeof expression === "function" ? `(${expression})()` : expression;
    const { result, exceptionDetails } = await this.cdp.send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  /** Espera a expressão ficar verdadeira (polling) e devolve o valor. */
  async waitFor(expression, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`waitFor: tempo esgotado (${String(expression).slice(0, 120)}) — último valor: ${last}`);
  }

  async screenshot(file) {
    const { data } = await this.cdp.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }
}

export async function launchBrowser({ width = 1400, height = 900 } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error("Nenhum Chrome/Edge encontrado (defina CHROME_PATH).");
  const port = await freePort();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcanjo-chrome-"));
  const proc = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDir}`,
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let wsUrl;
  const deadline = Date.now() + 15000;
  while (!wsUrl && Date.now() < deadline) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error("O navegador não abriu a porta de depuração a tempo.");
  }
  const browser = await Cdp.connect(wsUrl);
  const pages = [];

  return {
    /** Nova aba num contexto isolado (cookies próprios). */
    async newPage(baseUrl) {
      const { browserContextId } = await browser.send("Target.createBrowserContext");
      const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
      const cdp = await Cdp.connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const page = new Page(cdp, baseUrl);
      await page.init();
      pages.push(page);
      return page;
    },
    async close() {
      for (const p of pages) p.cdp.close();
      try {
        await browser.send("Browser.close");
      } catch {
        // já fechado
      }
      browser.close();
      await new Promise((r) => (proc.exitCode !== null ? r() : proc.once("exit", r)));
      fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
