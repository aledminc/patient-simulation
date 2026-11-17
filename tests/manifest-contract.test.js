import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(await readFile(new URL("../public/model-manifest.json", import.meta.url), "utf8"));

describe("production model contract", () => {
  it("pins every model asset with unique cache keys and valid integrity metadata", () => {
    const assets = manifest.models.flatMap(model => model.assets);
    expect(manifest.schemaVersion).toBe(1);
    expect(new Set(assets.map(asset => asset.canonicalUrl)).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.size).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("keeps the Kokoro runtime, pinned repository, and supported voice aligned", async () => {
    const tts = manifest.models.find(model => model.id === "tts");
    const worker = await readFile(new URL("../src/workers/tts.worker.js", import.meta.url), "utf8");
    expect(tts.repo).toBe("onnx-community/Kokoro-82M-v1.1-zh-ONNX");
    expect(tts.assets.some(asset => asset.localPath === "tts/voices/af_maple.bin")).toBe(true);
    expect(worker).toContain(`const MODEL_ID = "${tts.repo}"`);
    expect(worker).toContain(`payload.voice || "af_maple"`);
  });

  it("locks Qwen to a small context, short output, and non-thinking generation", async () => {
    const registry = await readFile(new URL("../src/models/model-registry.js", import.meta.url), "utf8");
    const client = await readFile(new URL("../src/runtime/llm-client.js", import.meta.url), "utf8");
    expect(registry).toContain("context_window_size: 1024");
    expect(registry).toContain("enable_thinking: false");
    expect(client).toContain("max_tokens: 60");
    expect(client.match(/enable_thinking: false/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
