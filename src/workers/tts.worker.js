import { env } from "@huggingface/transformers";
import { KokoroTTS } from "@uzen/kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.1-zh-ONNX";
const VOICE_BASE = "https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/voices";
let synthesizer = null;

env.allowLocalModels = false;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", self.location.origin).href,
  mjs: new URL("/ort/ort-wasm-simd-threaded.mjs", self.location.origin).href
};
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, self.navigator?.hardwareConcurrency || 1));
env.backends.onnx.wasm.proxy = false;

function emit(event) {
  self.postMessage({ type: "event", event });
}

async function load() {
  if (!synthesizer) {
    synthesizer = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      voicePath: VOICE_BASE,
      progress_callback: progress => emit({ type: "load-progress", stage: "tts", progress })
    });
  }
  return { ready: true };
}

self.onmessage = async event => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    let transfer = [];
    if (type === "load") {
      result = await load();
    } else if (type === "synthesize") {
      await load();
      const rawAudio = await synthesizer.generate(String(payload.text).slice(0, 600), {
        voice: payload.voice || "af_maple",
        speed: Number(payload.speed) || 1
      });
      const samples = rawAudio.data.slice();
      result = { audio: samples.buffer, sampleRate: rawAudio.sampling_rate };
      transfer = [samples.buffer];
    } else if (type === "dispose") {
      await synthesizer?.model?.dispose?.();
      synthesizer = null;
      result = { disposed: true };
    } else {
      throw new Error(`Unknown TTS operation: ${type}`);
    }
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: "TTS_FAILED", message: String(error?.message || error), retryable: true } });
  }
};

