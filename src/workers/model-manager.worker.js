import { downloadAndVerifyAsset, MODEL_CACHE_NAME, verifyCachedAsset } from "../models/download-core.js";

const controllers = new Map();

function serializeError(error) {
  return {
    code: error?.name === "AbortError" ? "DOWNLOAD_CANCELLED" : "MODEL_CACHE_ERROR",
    message: String(error?.message || error),
    retryable: true
  };
}

function emit(event) {
  self.postMessage({ type: "event", event });
}

async function inventory(model, cache) {
  const missing = [];
  for (const asset of model.assets) {
    const response = await cache.match(asset.canonicalUrl);
    if (!response || Number(response.headers.get("X-Patient-Model-Size") || 0) !== asset.size) missing.push(asset.localPath);
  }
  return { complete: missing.length === 0, missing };
}

async function downloadModel(id, payload, signal) {
  const { model, manifestVersion, baseUrl = "", repair = false } = payload;
  const cache = await caches.open(MODEL_CACHE_NAME);
  const total = model.bytes;
  let completed = 0;
  let lastEmit = 0;
  for (const asset of model.assets) {
    if (signal.aborted) throw new DOMException("Download cancelled.", "AbortError");
    let alreadyValid = false;
    if (!repair) {
      const existing = await cache.match(asset.canonicalUrl);
      alreadyValid = Boolean(existing && Number(existing.headers.get("X-Patient-Model-Size") || 0) === asset.size && existing.headers.get("X-Patient-Model-SHA256") === asset.sha256);
    } else {
      const checked = await verifyCachedAsset(asset, cache, { signal });
      alreadyValid = checked.ok;
      if (!checked.ok) await cache.delete(asset.canonicalUrl);
    }
    if (alreadyValid) {
      completed += asset.size;
      emit({ type: "progress", modelId: model.id, completed, total, file: asset.localPath });
      continue;
    }
    const sourceUrl = baseUrl
      ? `${String(baseUrl).replace(/\/$/, "")}/${manifestVersion}/${asset.localPath}`
      : asset.sourceUrl;
    let fileReceived = 0;
    await downloadAndVerifyAsset(asset, {
      sourceUrl,
      cache,
      signal,
      onProgress: ({ received }) => {
        fileReceived = received;
        const now = performance.now();
        if (now - lastEmit > 100) {
          lastEmit = now;
          emit({ type: "progress", modelId: model.id, completed: completed + fileReceived, total, file: asset.localPath });
        }
      }
    });
    completed += asset.size;
    emit({ type: "progress", modelId: model.id, completed, total, file: asset.localPath });
  }
  const checked = await inventory(model, cache);
  if (!checked.complete) throw new Error(`Model cache is incomplete: ${checked.missing.join(", ")}`);
  return { modelId: model.id, complete: true, bytes: total };
}

self.onmessage = async event => {
  const { id, type, payload } = event.data || {};
  if (type === "cancel") {
    controllers.get(payload?.requestId)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    let result;
    if (type === "download" || type === "repair") {
      result = await downloadModel(id, { ...payload, repair: type === "repair" }, controller.signal);
    } else if (type === "inventory") {
      result = await inventory(payload.model, cache);
    } else if (type === "remove") {
      for (const asset of payload.model.assets) await cache.delete(asset.canonicalUrl);
      result = { removed: true, modelId: payload.model.id };
    } else {
      throw new Error(`Unknown model manager operation: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: serializeError(error) });
  } finally {
    controllers.delete(id);
  }
};

