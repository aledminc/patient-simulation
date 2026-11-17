import { createSHA256 } from "hash-wasm";

export const MODEL_CACHE_NAME = "patient-model-assets-v1";

export async function sha256Stream(stream, { onChunk = () => {}, signal } = {}) {
  const hasher = await createSHA256();
  const reader = stream.getReader();
  let bytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Download cancelled.", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      bytes += value.byteLength;
      onChunk(value.byteLength, bytes);
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hasher.digest("hex"), bytes };
}

export async function downloadAndVerifyAsset(asset, {
  sourceUrl = asset.sourceUrl,
  fetchImpl = fetch,
  cache,
  signal,
  onProgress = () => {}
} = {}) {
  if (!cache) throw new TypeError("A Cache-compatible store is required.");
  const response = await fetchImpl(sourceUrl, { signal, mode: "cors", credentials: "omit", cache: "no-store" });
  if (!response.ok || !response.body) throw new Error(`Download failed for ${asset.localPath}: HTTP ${response.status}`);
  const [cacheStream, hashStream] = response.body.tee();
  const headers = new Headers(response.headers);
  headers.set("Content-Length", String(asset.size));
  headers.set("X-Patient-Model-SHA256", asset.sha256);
  headers.set("X-Patient-Model-Size", String(asset.size));
  const cacheWrite = cache.put(asset.canonicalUrl, new Response(cacheStream, { status: 200, headers }));
  try {
    const verified = await sha256Stream(hashStream, {
      signal,
      onChunk: (delta, received) => onProgress({ delta, received, total: asset.size })
    });
    await cacheWrite;
    if (verified.bytes !== asset.size) throw new Error(`Size mismatch for ${asset.localPath}: expected ${asset.size}, received ${verified.bytes}.`);
    if (verified.sha256.toLowerCase() !== asset.sha256.toLowerCase()) {
      throw new Error(`Integrity check failed for ${asset.localPath}.`);
    }
    return verified;
  } catch (error) {
    await cache.delete(asset.canonicalUrl).catch(() => {});
    throw error;
  }
}

export async function verifyCachedAsset(asset, cache, { signal, onProgress = () => {} } = {}) {
  const response = await cache.match(asset.canonicalUrl);
  if (!response?.body) return { ok: false, reason: "missing" };
  try {
    const verified = await sha256Stream(response.body, {
      signal,
      onChunk: (delta, received) => onProgress({ delta, received, total: asset.size })
    });
    const ok = verified.bytes === asset.size && verified.sha256.toLowerCase() === asset.sha256.toLowerCase();
    return { ok, reason: ok ? "verified" : "integrity", ...verified };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return { ok: false, reason: "read-error", message: String(error?.message || error) };
  }
}

