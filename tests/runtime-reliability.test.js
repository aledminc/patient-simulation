import { describe, expect, it, vi } from "vitest";
import { detectCapabilities, selectPerformanceTier } from "../src/runtime/capabilities.js";
import { InferenceQueue, QueueFullError } from "../src/runtime/inference-queue.js";
import { ManagedWorker } from "../src/runtime/managed-worker.js";
import { BrowserRuntime } from "../src/runtime/browser-runtime.js";

class FakeWorker {
  constructor(handler = null) { this.handler = handler; this.terminated = false; }
  postMessage(message) { this.handler?.(message, this); }
  terminate() { this.terminated = true; }
  respond(message) { this.onmessage?.({ data: message }); }
}

function runtimeFixture() {
  const models = {
    manifest: { models: [] },
    snapshot: () => ({ models: {} }),
    isReady: () => true,
    dispose: () => {}
  };
  const diagnostics = {
    record: vi.fn(),
    encounterComplete: vi.fn(),
    recoveredError: vi.fn(),
    snapshot: () => ({ encounters: 0 })
  };
  const environment = { localStorage: null, speechSynthesis: { cancel: vi.fn(), speak: vi.fn() } };
  const runtime = new BrowserRuntime({ modelManager: models, diagnostics, environment });
  runtime.capabilities = { webgpu: true, systemSpeech: false };
  return { runtime, diagnostics };
}

describe("runtime reliability", () => {
  it("selects compatibility mode without WebGPU", async () => {
    const capabilities = await detectCapabilities({
      isSecureContext: true,
      Worker: class {},
      WebAssembly,
      caches: {},
      indexedDB: {},
      navigator: {
        hardwareConcurrency: 8,
        deviceMemory: 16,
        storage: { estimate: async () => ({ quota: 2_000_000_000, usage: 10_000 }) }
      }
    });
    expect(capabilities.webgpu).toBe(false);
    expect(capabilities.tier.id).toBe("wasm");
    expect(capabilities.tier.models).toEqual(["stt", "tts"]);
  });

  it("uses storage-limited mode when full inference cannot fit", () => {
    expect(selectPerformanceTier({ worker:true, webAssembly:true, cacheStorage:true, webgpu:true, deviceMemoryGb:16, availableStorageBytes:100 })).toMatchObject({ id:"storage-limited", models:[] });
  });

  it("runs inference operations strictly sequentially while timers remain responsive", async () => {
    const events = [];
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 2);
    const queue = new InferenceQueue();
    const first = queue.enqueue("stt", async () => { events.push("stt-start"); await new Promise(resolve => setTimeout(resolve, 20)); events.push("stt-end"); });
    const second = queue.enqueue("llm", async () => { events.push("llm-start"); await new Promise(resolve => setTimeout(resolve, 5)); events.push("llm-end"); });
    await Promise.all([first, second]);
    clearInterval(timer);
    expect(events).toEqual(["stt-start", "stt-end", "llm-start", "llm-end"]);
    expect(ticks).toBeGreaterThan(2);
  });

  it("rejects excess queued work", async () => {
    const queue = new InferenceQueue({ maxPending: 1 });
    let release;
    const blocker = queue.enqueue("one", () => new Promise(resolve => { release = resolve; }));
    const queued = queue.enqueue("two", async () => {});
    await expect(queue.enqueue("three", async () => {})).rejects.toBeInstanceOf(QueueFullError);
    release();
    await Promise.all([blocker, queued]);
  });

  it("times out and restarts an unresponsive worker", async () => {
    const workers = [];
    const managed = new ManagedWorker("test-worker", () => {
      const worker = new FakeWorker(); workers.push(worker); return worker;
    }, { defaultTimeoutMs: 10 });
    await expect(managed.request("hang")).rejects.toMatchObject({ code: "WORKER_TIMEOUT" });
    expect(workers[0].terminated).toBe(true);
    const request = managed.request("respond", {}, { timeoutMs: 100 });
    const second = workers[1];
    const id = [...managed.pending.keys()][0];
    second.respond({ id, ok: true, result: { ready: true } });
    await expect(request).resolves.toEqual({ ready: true });
  });

  it("falls back to the approved scripted response when LLM generation fails", async () => {
    const { runtime, diagnostics } = runtimeFixture();
    runtime.llm = { phrase: vi.fn().mockRejectedValue(Object.assign(new Error("GPU lost"), { code: "GPU_LOST" })), dispose: vi.fn() };
    const plan = {
      scriptedReply: "It began last night.",
      phrasingPlan: { approvedStatements: ["It began last night."], speakingStyle: "calm", intent: "answer", maximumWords: 60 }
    };
    await expect(runtime.phrase(plan)).resolves.toMatchObject({ text: "It began last night.", source: "scripted-fallback", error: "GPU_LOST" });
    expect(diagnostics.record).toHaveBeenCalledWith("llm", expect.any(Number), { success: false });
    expect(runtime.snapshot().notices.at(-1).message).toMatch(/scripted response/i);
  });

  it("retains audio and keeps typed input viable when STT fails", async () => {
    const { runtime, diagnostics } = runtimeFixture();
    runtime.lastRecording = { audio: new Float32Array(1600), sampleRate: 16_000 };
    runtime.stt = { request: vi.fn().mockRejectedValue(Object.assign(new Error("decoder failed"), { code: "STT_FAILED" })), dispose: vi.fn() };
    await expect(runtime.transcribeLastRecording()).rejects.toMatchObject({ code: "STT_FAILED" });
    expect(runtime.lastRecording.audio).toHaveLength(1600);
    expect(runtime.snapshot().notices.at(-1).message).toMatch(/typed input remains active/i);
    expect(diagnostics.record).toHaveBeenCalledWith("stt", expect.any(Number), { success: false });
  });

  it("degrades a Kokoro failure to text-only when no system voice exists", async () => {
    const { runtime, diagnostics } = runtimeFixture();
    runtime.tts = { request: vi.fn().mockRejectedValue(Object.assign(new Error("synthesis failed"), { code: "TTS_FAILED" })), dispose: vi.fn() };
    await expect(runtime.speak("I feel dizzy.")).resolves.toEqual({ source: "text-only" });
    expect(runtime.snapshot().notices.at(-1).message).toMatch(/system voice or text-only/i);
    expect(diagnostics.record).toHaveBeenCalledWith("tts", 0, { success: false });
  });
});

