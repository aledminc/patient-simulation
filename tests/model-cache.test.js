import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { downloadAndVerifyAsset, verifyCachedAsset } from "../src/models/download-core.js";

class MemoryCache {
  constructor() { this.items = new Map(); }
  async put(key, response) { this.items.set(String(key), response); }
  async match(key) { return this.items.get(String(key))?.clone(); }
  async delete(key) { return this.items.delete(String(key)); }
}

function fixture(bytes, sha = createHash("sha256").update(bytes).digest("hex")) {
  return { localPath: "fixture/model.bin", sourceUrl: "https://models.example/model.bin", canonicalUrl: "https://canonical.example/model.bin", size: bytes.length, sha256: sha };
}

describe("verified model cache", () => {
  it("streams, verifies, stores, and re-verifies an asset", async () => {
    const bytes = new TextEncoder().encode("verified model fixture");
    const cache = new MemoryCache();
    const asset = fixture(bytes);
    await downloadAndVerifyAsset(asset, { cache, fetchImpl: async () => new Response(bytes) });
    expect(await verifyCachedAsset(asset, cache)).toMatchObject({ ok: true, bytes: bytes.length });
  });

  it("removes a cache entry after an integrity failure", async () => {
    const bytes = new TextEncoder().encode("corrupt model fixture");
    const cache = new MemoryCache();
    const asset = fixture(bytes, "0".repeat(64));
    await expect(downloadAndVerifyAsset(asset, { cache, fetchImpl: async () => new Response(bytes) })).rejects.toThrow(/Integrity check failed/);
    expect(await cache.match(asset.canonicalUrl)).toBeUndefined();
  });

  it("simulates interruption and leaves no partial cache entry", async () => {
    const bytes = new Uint8Array(64 * 1024).fill(7);
    const cache = new MemoryCache();
    const controller = new AbortController();
    const stream = new ReadableStream({
      start(streamController) {
        streamController.enqueue(bytes.slice(0, 1024));
        setTimeout(() => streamController.enqueue(bytes.slice(1024)), 5);
        setTimeout(() => streamController.close(), 10);
      }
    });
    const promise = downloadAndVerifyAsset(fixture(bytes), {
      cache,
      signal: controller.signal,
      fetchImpl: async () => new Response(stream),
      onProgress: () => controller.abort()
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(await cache.match("https://canonical.example/model.bin")).toBeUndefined();
  });

  it("detects a corrupt cached asset and repairs it from a verified source", async () => {
    const expected = new TextEncoder().encode("known-good model bytes");
    const corrupt = new TextEncoder().encode("corrupt model bytes!!!");
    const cache = new MemoryCache();
    const asset = fixture(expected);
    await cache.put(asset.canonicalUrl, new Response(corrupt));

    await expect(verifyCachedAsset(asset, cache)).resolves.toMatchObject({ ok: false, reason: "integrity" });
    await cache.delete(asset.canonicalUrl);
    await downloadAndVerifyAsset(asset, { cache, fetchImpl: async () => new Response(expected) });

    await expect(verifyCachedAsset(asset, cache)).resolves.toMatchObject({ ok: true, bytes: expected.length });
  });
});

