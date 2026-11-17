function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function selectPerformanceTier(capabilities) {
  if (!capabilities.worker || !capabilities.webAssembly || !capabilities.cacheStorage) {
    return { id: "compatibility", label: "Compatibility", models: [], reason: "Required browser worker or cache APIs are unavailable." };
  }
  if (!capabilities.webgpu) {
    return {
      id: "wasm",
      label: "Voice compatibility",
      models: capabilities.availableStorageBytes >= 250 * 1024 ** 2 ? ["stt", "tts"] : [],
      reason: "WebGPU is unavailable; scripted patient text and WASM speech are used."
    };
  }
  if (capabilities.deviceMemoryGb && capabilities.deviceMemoryGb < 8) {
    return {
      id: "balanced",
      label: "Balanced",
      models: capabilities.availableStorageBytes >= 250 * 1024 ** 2 ? ["stt", "tts"] : [],
      reason: "Limited reported memory; the LLM is disabled to protect responsiveness."
    };
  }
  if (capabilities.availableStorageBytes < 700 * 1024 ** 2) {
    return {
      id: "storage-limited",
      label: "Storage limited",
      models: [],
      reason: "Less than 700 MB of browser storage is currently available."
    };
  }
  return {
    id: "full",
    label: "Full browser AI",
    models: ["stt", "llm", "tts"],
    reason: "WebGPU, workers, and sufficient reported storage are available."
  };
}

export async function detectCapabilities(environment = globalThis) {
  const navigatorObject = environment.navigator || {};
  let storageEstimate = null;
  try { storageEstimate = await navigatorObject.storage?.estimate?.(); } catch {}
  const quota = safeNumber(storageEstimate?.quota);
  const usage = safeNumber(storageEstimate?.usage);
  let adapter = null;
  let adapterError = null;
  if (navigatorObject.gpu?.requestAdapter) {
    try {
      adapter = await navigatorObject.gpu.requestAdapter({ powerPreference: "high-performance" });
    } catch (error) {
      adapterError = String(error?.message || error);
    }
  }

  const capabilities = {
    secureContext: environment.isSecureContext === true || environment.location?.hostname === "127.0.0.1" || environment.location?.hostname === "localhost",
    worker: typeof environment.Worker === "function",
    webAssembly: typeof environment.WebAssembly === "object",
    webgpu: Boolean(adapter),
    webgpuFeatures: adapter ? [...adapter.features].map(String).sort() : [],
    maxStorageBufferBindingSize: safeNumber(adapter?.limits?.maxStorageBufferBindingSize),
    webgpuError: adapterError,
    crossOriginIsolated: environment.crossOriginIsolated === true,
    sharedArrayBuffer: typeof environment.SharedArrayBuffer === "function",
    serviceWorker: Boolean(navigatorObject.serviceWorker),
    cacheStorage: Boolean(environment.caches),
    indexedDb: Boolean(environment.indexedDB),
    opfs: Boolean(navigatorObject.storage?.getDirectory),
    microphone: Boolean(navigatorObject.mediaDevices?.getUserMedia),
    audioWorklet: typeof environment.AudioWorkletNode === "function",
    systemSpeech: Boolean(environment.speechSynthesis && environment.SpeechSynthesisUtterance),
    deviceMemoryGb: safeNumber(navigatorObject.deviceMemory),
    hardwareConcurrency: safeNumber(navigatorObject.hardwareConcurrency, 1),
    storageQuotaBytes: quota,
    storageUsageBytes: usage,
    availableStorageBytes: Math.max(0, quota - usage)
  };
  capabilities.tier = selectPerformanceTier(capabilities);
  return Object.freeze(capabilities);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
