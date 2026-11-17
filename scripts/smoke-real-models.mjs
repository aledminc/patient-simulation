import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const arguments_ = process.argv.slice(2);
const production = arguments_.includes("--production");
const modelArguments = arguments_.filter(argument => argument !== "--production");
const baseUrl = production ? "http://127.0.0.1:4173" : "http://127.0.0.1:8000";
const requested = modelArguments.length ? modelArguments : ["stt", "tts", "llm"];
const allowed = new Set(["stt", "tts", "llm"]);
if (requested.some(id => !allowed.has(id))) throw new Error("Model IDs must be stt, tts, or llm.");

const viteCli = resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js");
const viteArguments = production ? [viteCli, "preview", "--host", "127.0.0.1"] : [viteCli, "--host", "127.0.0.1"];
const server = spawn(process.execPath, viteArguments, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", chunk => process.stdout.write(`[vite] ${chunk}`));
server.stderr.on("data", chunk => process.stderr.write(`[vite] ${chunk}`));

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("The Vite server did not start.");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#mode").click();
  await page.locator(".modelrow").first().waitFor({ timeout: 120_000 });

  const downloads = {};
  for (const id of requested) {
    const started = performance.now();
    const removeButton = page.locator(`[data-model-action="remove"][data-model-id="${id}"]`);
    if (!await removeButton.count()) await page.locator(`[data-model-id="${id}"]`).first().click();
    await removeButton.waitFor({ timeout: 30 * 60_000 });
    downloads[id] = Math.round(performance.now() - started);
    console.log(`verified browser download ${id} in ${downloads[id]} ms`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#mode").click();
  for (const id of requested) {
    await page.locator(`[data-model-action="remove"][data-model-id="${id}"]`).waitFor({ timeout: 120_000 });
  }
  console.log(`verified persistent cache inventory after reload: ${requested.join(", ")}`);

  let workerUrls = { stt: "/src/workers/stt.worker.js", tts: "/src/workers/tts.worker.js" };
  if (production) {
    const assets = await readdir(resolve(process.cwd(), "dist", "assets"));
    workerUrls = {
      stt: `/assets/${assets.find(name => /^stt\.worker-.*\.js$/.test(name))}`,
      tts: `/assets/${assets.find(name => /^tts\.worker-.*\.js$/.test(name))}`
    };
  }

  const inference = await page.evaluate(async ({ ids, workerUrls, production }) => {
    function workerRequest(url, type, payload = {}, transfer = []) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(url, { type: "module" });
        const id = `smoke-${crypto.randomUUID()}`;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error(`${type} timed out`)); }, 5 * 60_000);
        worker.onmessage = event => {
          if (event.data?.id !== id) return;
          clearTimeout(timer);
          worker.terminate();
          if (event.data.ok) resolve(event.data.result);
          else reject(new Error(`${event.data.error?.code}: ${event.data.error?.message}`));
        };
        worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage({ id, type, payload }, transfer);
      });
    }

    const results = {};
    if (ids.includes("stt")) {
      await workerRequest(workerUrls.stt, "load");
      const samples = new Float32Array(16_000);
      const output = await workerRequest(workerUrls.stt, "transcribe", { audio: samples.buffer, sampleRate: 16_000 }, [samples.buffer]);
      results.stt = { ok: true, textLength: output.text.length, durationSeconds: output.durationSeconds };
    }
    if (ids.includes("tts")) {
      await workerRequest(workerUrls.tts, "load");
      const output = await workerRequest(workerUrls.tts, "synthesize", { text: "My dizziness began last night.", voice: "af_maple", speed: 1 });
      results.tts = { ok: output.audio.byteLength > 0, sampleRate: output.sampleRate, bytes: output.audio.byteLength };
    }
    if (ids.includes("llm")) {
      if (production) throw new Error("Production smoke uses the UI-owned LLM client; run the development smoke for direct LLM inference.");
      const adapter = await navigator.gpu?.requestAdapter?.();
      if (!adapter) {
        results.llm = { ok: false, skipped: "WebGPU adapter unavailable in headless Chrome" };
      } else {
        const [{ LlmClient }, manifest] = await Promise.all([
          import("/src/runtime/llm-client.js"),
          fetch("/model-manifest.json").then(response => response.json())
        ]);
        const client = new LlmClient();
        try {
          const text = await client.phrase([
            { role: "system", content: "Use only the approved sentence. Do not think. Return only patient speech." },
            { role: "user", content: "Approved sentence: My dizziness began last night." }
          ], manifest, { timeoutMs: 120_000 });
          results.llm = { ok: Boolean(text), characters: text.length, leakedThinking: /<think>/i.test(text) };
        } finally {
          client.dispose();
        }
      }
    }
    return results;
  }, { ids: requested, workerUrls, production });

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify({ requested, downloadsMs: downloads, inference }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
