import { webLlmConfiguration } from "../models/model-registry.js";

export class LlmClient {
  constructor({ onProgress = () => {}, workerFactory } = {}) {
    this.onProgress = onProgress;
    this.workerFactory = workerFactory || (() => new Worker(new URL("../workers/llm.worker.js", import.meta.url), { type: "module" }));
    this.worker = null;
    this.engine = null;
    this.loading = null;
  }

  async load(manifest) {
    if (this.engine) return this.engine;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const config = webLlmConfiguration(manifest);
      const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
      this.worker = this.workerFactory();
      const appConfig = {
        model_list: [config.modelRecord],
        useIndexedDBCache: false,
        cacheBackend: "cache"
      };
      try {
        this.engine = await CreateWebWorkerMLCEngine(this.worker, config.modelId, {
          appConfig,
          logLevel: "WARN",
          initProgressCallback: report => this.onProgress({ type: "load-progress", stage: "llm", progress: report })
        }, { context_window_size: 1024 });
        return this.engine;
      } catch (error) {
        this.restart();
        throw error;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async phrase(messages, manifest, { signal, timeoutMs = 45_000 } = {}) {
    const engine = await this.load(manifest);
    if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
    let timer;
    const abort = async () => {
      try { await engine.interruptGenerate(); } catch {}
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const completion = engine.chat.completions.create({
        messages,
        temperature: 0.25,
        top_p: 0.8,
        max_tokens: 60,
        enable_thinking: false,
        stream: false,
        extra_body: { enable_thinking: false }
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(async () => {
          await abort();
          reject(new Error(`LLM generation exceeded ${timeoutMs} ms.`));
        }, timeoutMs);
      });
      const response = await Promise.race([completion, timeout]);
      return String(response?.choices?.[0]?.message?.content || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .trim();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async interrupt() {
    try { await this.engine?.interruptGenerate(); } catch {}
  }

  restart() {
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.loading = null;
  }

  dispose() {
    this.restart();
  }
}

