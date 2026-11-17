import { PcmRecorder } from "../audio/pcm-recorder.js";
import { ModelManager } from "../models/model-manager.js";
import { buildPhrasingMessages } from "../core/patient-controller.js";
import { detectCapabilities } from "./capabilities.js";
import { AggregateDiagnostics } from "./diagnostics.js";
import { InferenceQueue } from "./inference-queue.js";
import { LlmClient } from "./llm-client.js";
import { ManagedWorker, WorkerRequestError } from "./managed-worker.js";

export class RuntimeUnavailableError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuntimeUnavailableError";
    this.code = code;
  }
}

export class BrowserRuntime {
  constructor({ modelManager, diagnostics, environment = globalThis } = {}) {
    this.environment = environment;
    this.listeners = new Set();
    this.capabilities = null;
    this.queueState = { running: null, pending: [] };
    this.notices = [];
    this.lastRecording = null;
    this.voiceEnabled = true;
    this.sttLoaded = false;
    this.ttsLoaded = false;
    this.downloadController = null;
    this.diagnostics = diagnostics || new AggregateDiagnostics(environment.localStorage);
    this.queue = new InferenceQueue({ maxPending: 2, onStateChange: state => { this.queueState = state; this.#emit(); } });
    this.models = modelManager || new ModelManager({ onChange: () => this.#emit() });
    this.stt = new ManagedWorker("speech recognition", () => new Worker(new URL("../workers/stt.worker.js", import.meta.url), { type: "module" }), {
      defaultTimeoutMs: 90_000,
      onEvent: event => this.#workerEvent("stt", event)
    });
    this.tts = new ManagedWorker("speech synthesis", () => new Worker(new URL("../workers/tts.worker.js", import.meta.url), { type: "module" }), {
      defaultTimeoutMs: 90_000,
      onEvent: event => this.#workerEvent("tts", event)
    });
    this.llm = new LlmClient({ onProgress: event => this.#workerEvent("llm", event) });
    this.recorder = new PcmRecorder();
  }

  async initialize() {
    await this.#registerServiceWorker();
    this.capabilities = await detectCapabilities(this.environment);
    await this.models.initialize();
    this.#emit();
    return this.snapshot();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    return {
      capabilities: this.capabilities,
      models: this.models.snapshot(),
      queue: { ...this.queueState, pending: [...this.queueState.pending] },
      notices: [...this.notices],
      recording: this.recorder.recording,
      hasRecording: Boolean(this.lastRecording),
      voiceEnabled: this.voiceEnabled,
      diagnostics: this.diagnostics.snapshot()
    };
  }

  async downloadRecommended() {
    const ids = this.capabilities?.tier?.models || [];
    if (!ids.length) throw new RuntimeUnavailableError("NO_RECOMMENDED_MODELS", "This browser is in compatibility mode; no model download is recommended.");
    this.downloadController?.abort();
    this.downloadController = new AbortController();
    try {
      await this.models.downloadMany(ids, { signal: this.downloadController.signal });
    } finally {
      this.downloadController = null;
      this.#emit();
    }
  }

  async downloadModel(modelId) {
    this.downloadController?.abort();
    this.downloadController = new AbortController();
    try { await this.models.download(modelId, { signal: this.downloadController.signal }); }
    finally { this.downloadController = null; this.#emit(); }
  }

  cancelDownload() {
    this.downloadController?.abort();
  }

  async repairModel(modelId) {
    await this.models.repair(modelId);
  }

  async removeModel(modelId) {
    if (modelId === "stt") { this.stt.dispose(); this.sttLoaded = false; }
    if (modelId === "tts") { this.tts.dispose(); this.ttsLoaded = false; }
    if (modelId === "llm") this.llm.dispose();
    await this.models.remove(modelId);
  }

  async phrase(turnPlan, { signal } = {}) {
    if (!turnPlan?.phrasingPlan) return { text: turnPlan.scriptedReply, source: "scripted" };
    if (!this.capabilities?.webgpu || !this.models.isReady("llm")) return { text: turnPlan.scriptedReply, source: "scripted-fallback" };
    return this.queue.enqueue("llm", async queueSignal => {
      const started = performance.now();
      try {
        const text = await this.llm.phrase(buildPhrasingMessages(turnPlan.phrasingPlan), this.models.manifest, { signal: queueSignal || signal });
        this.diagnostics.record("llm", performance.now() - started);
        return { text, source: "llm" };
      } catch (error) {
        this.diagnostics.record("llm", performance.now() - started, { success: false });
        this.#notice("The phrasing model failed; the approved scripted response was used.", "warning");
        return { text: turnPlan.scriptedReply, source: "scripted-fallback", error: error?.code || "LLM_FAILED" };
      }
    }, { signal });
  }

  async startRecording() {
    await this.recorder.start();
    this.#emit();
  }

  async stopAndTranscribe({ signal } = {}) {
    this.lastRecording = await this.recorder.stop();
    this.#emit();
    return this.transcribeLastRecording({ signal });
  }

  async transcribeLastRecording({ signal } = {}) {
    if (!this.lastRecording) throw new RuntimeUnavailableError("NO_RECORDING", "There is no recording to transcribe.");
    if (!this.models.isReady("stt")) throw new RuntimeUnavailableError("STT_NOT_READY", "Whisper is not installed. Keep the recording and type or download the speech model.");
    return this.queue.enqueue("stt", async queueSignal => {
      const started = performance.now();
      try {
        if (!this.sttLoaded) {
          await this.stt.request("load", {}, { timeoutMs: 4 * 60_000, signal: queueSignal || signal });
          this.sttLoaded = true;
        }
        const copy = this.lastRecording.audio.slice();
        const result = await this.stt.request("transcribe", {
          audio: copy.buffer,
          sampleRate: this.lastRecording.sampleRate
        }, { timeoutMs: 90_000, transfer: [copy.buffer], signal: queueSignal || signal });
        this.diagnostics.record("stt", performance.now() - started);
        return result;
      } catch (error) {
        this.diagnostics.record("stt", performance.now() - started, { success: false });
        this.sttLoaded = false;
        this.#notice("Speech recognition failed. Your recording is still available and typed input remains active.", "warning");
        throw error;
      }
    }, { signal });
  }

  clearRecording() {
    this.lastRecording = null;
    this.#emit();
  }

  async speak(text, { signal, demeanor = "calm" } = {}) {
    if (!this.voiceEnabled || !String(text).trim()) return { source: "text-only" };
    if (!this.models.isReady("tts")) return this.#systemSpeak(text, { signal });
    const speed = { anxious: 1.08, frustrated: 1.04, upset: 0.94, tearful: 0.9, relieved: 0.98 }[demeanor] || 1;
    try {
      const audio = await this.queue.enqueue("tts", async queueSignal => {
        const started = performance.now();
        if (!this.ttsLoaded) {
          await this.tts.request("load", {}, { timeoutMs: 4 * 60_000, signal: queueSignal || signal });
          this.ttsLoaded = true;
        }
        const result = await this.tts.request("synthesize", { text, voice: "af_maple", speed }, { timeoutMs: 90_000, signal: queueSignal || signal });
        this.diagnostics.record("tts", performance.now() - started);
        return result;
      }, { signal });
      await this.#playSamples(new Float32Array(audio.audio), audio.sampleRate, signal);
      return { source: "kokoro" };
    } catch (error) {
      this.diagnostics.record("tts", 0, { success: false });
      this.ttsLoaded = false;
      this.#notice("Kokoro speech failed; the system voice or text-only mode was used.", "warning");
      return this.#systemSpeak(text, { signal });
    }
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) this.environment.speechSynthesis?.cancel?.();
    this.#emit();
  }

  clearNotice(index) {
    this.notices.splice(index, 1);
    this.#emit();
  }

  encounterComplete() {
    this.diagnostics.encounterComplete();
    this.#emit();
  }

  handleGlobalError(kind) {
    this.diagnostics.recoveredError();
    this.#notice(`A ${kind} error was contained. Compatibility features remain available.`, "warning");
  }

  dispose() {
    void this.recorder.cancel();
    this.stt.dispose();
    this.tts.dispose();
    this.llm.dispose();
    this.models.dispose();
  }

  async #registerServiceWorker() {
    if (!this.environment.navigator?.serviceWorker || !this.environment.isSecureContext) return;
    try {
      await this.environment.navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await this.environment.navigator.serviceWorker.ready;
    } catch {
      this.#notice("Offline app caching could not start. The simulator will still work while this page is open.", "warning");
    }
  }

  #workerEvent(stage, event) {
    if (event.type === "restart") {
      if (stage === "stt") this.sttLoaded = false;
      if (stage === "tts") this.ttsLoaded = false;
    }
    this.#emit();
  }

  async #playSamples(samples, sampleRate, signal) {
    if (signal?.aborted) throw new DOMException("Playback cancelled.", "AbortError");
    const context = new AudioContext({ latencyHint: "interactive", sampleRate });
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    await new Promise((resolve, reject) => {
      const abort = () => { source.stop(); reject(new DOMException("Playback cancelled.", "AbortError")); };
      signal?.addEventListener("abort", abort, { once: true });
      source.onended = () => { signal?.removeEventListener("abort", abort); resolve(); };
      source.start();
    }).finally(() => context.close().catch(() => {}));
  }

  #systemSpeak(text, { signal } = {}) {
    if (!this.capabilities?.systemSpeech) return Promise.resolve({ source: "text-only" });
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(String(text));
      const finish = source => resolve({ source });
      utterance.onend = () => finish("system-voice");
      utterance.onerror = () => finish("text-only");
      signal?.addEventListener("abort", () => { this.environment.speechSynthesis.cancel(); finish("text-only"); }, { once: true });
      this.environment.speechSynthesis.cancel();
      this.environment.speechSynthesis.speak(utterance);
    });
  }

  #notice(message, level = "info") {
    this.notices.push({ message, level, at: Date.now() });
    if (this.notices.length > 5) this.notices.shift();
    this.#emit();
  }

  #emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch {}
    }
  }
}

export function installGlobalErrorBoundary(runtime, environment = globalThis) {
  environment.addEventListener?.("unhandledrejection", event => {
    event.preventDefault();
    runtime.handleGlobalError("background task");
  });
  environment.addEventListener?.("error", event => {
    event.preventDefault();
    runtime.handleGlobalError("runtime");
  });
}
