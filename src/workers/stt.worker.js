import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/whisper-tiny.en";
const REVISION = "794207fec2761281fe63a23a94b7e9f53a4efbc1";
let transcriber = null;

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
  if (!transcriber) {
    transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
      revision: REVISION,
      dtype: "q8",
      device: "wasm",
      progress_callback: progress => emit({ type: "load-progress", stage: "stt", progress })
    });
  }
  return { ready: true };
}

function resample(input, sourceRate, targetRate = 16_000) {
  if (sourceRate === targetRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

self.onmessage = async event => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    if (type === "load") {
      result = await load();
    } else if (type === "transcribe") {
      await load();
      const audio = resample(new Float32Array(payload.audio), payload.sampleRate);
      if (audio.length < 800) throw new Error("The recording is too short to transcribe.");
      const output = await transcriber(audio, {
        chunk_length_s: 15,
        stride_length_s: 3,
        return_timestamps: false
      });
      result = { text: String(output?.text || "").trim(), durationSeconds: audio.length / 16_000 };
    } else if (type === "dispose") {
      await transcriber?.dispose?.();
      transcriber = null;
      result = { disposed: true };
    } else {
      throw new Error(`Unknown STT operation: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: { code: "STT_FAILED", message: String(error?.message || error), retryable: true } });
  }
};

