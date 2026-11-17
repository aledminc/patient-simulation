import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestVersion = "2026-11-17.2";

const definitions = [
  {
    id: "stt",
    label: "Whisper tiny.en",
    kind: "transformers",
    repo: "onnx-community/whisper-tiny.en",
    revision: "794207fec2761281fe63a23a94b7e9f53a4efbc1",
    canonicalRevision: "794207fec2761281fe63a23a94b7e9f53a4efbc1",
    files: [
      "added_tokens.json", "config.json", "generation_config.json", "merges.txt",
      "normalizer.json", "preprocessor_config.json", "special_tokens_map.json",
      "tokenizer.json", "tokenizer_config.json", "vocab.json",
      "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"
    ]
  },
  {
    id: "tts",
    label: "Kokoro 82M v1.1 q8",
    kind: "transformers",
    repo: "onnx-community/Kokoro-82M-v1.1-zh-ONNX",
    revision: "6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3",
    canonicalRevision: "main",
    files: [
      "config.json", "tokenizer.json", "tokenizer_config.json",
      "onnx/model_quantized.onnx", "voices/af_maple.bin"
    ]
  },
  {
    id: "llm",
    label: "Qwen3 0.6B q4f16",
    kind: "webllm",
    repo: "mlc-ai/Qwen3-0.6B-q4f16_1-MLC",
    revision: "8c14ce481d4c692769976ad52afea453a102df19",
    canonicalRevision: "8c14ce481d4c692769976ad52afea453a102df19",
    files: [
      "merges.txt", "mlc-chat-config.json", "ndarray-cache.json", "tensor-cache.json",
      "tokenizer.json", "tokenizer_config.json", "vocab.json",
      ...Array.from({ length: 9 }, (_, index) => `params_shard_${index}.bin`)
    ]
  }
];

async function sha256Response(response) {
  if (!response.ok) throw new Error(`Unable to hash ${response.url}: HTTP ${response.status}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), size };
}

async function buildHuggingFaceModel(definition) {
  const metadataResponse = await fetch(`https://huggingface.co/api/models/${definition.repo}?blobs=true`);
  if (!metadataResponse.ok) throw new Error(`Unable to read ${definition.repo} metadata`);
  const metadata = await metadataResponse.json();
  if (metadata.sha !== definition.revision) {
    throw new Error(`${definition.repo} moved from pinned revision ${definition.revision} to ${metadata.sha}; review before updating.`);
  }
  const siblings = new Map(metadata.siblings.map(file => [file.rfilename, file]));
  const assets = [];
  for (const file of definition.files) {
    const metadataFile = siblings.get(file);
    if (!metadataFile) throw new Error(`${definition.repo} is missing ${file}`);
    const sourceUrl = `https://huggingface.co/${definition.repo}/resolve/${definition.revision}/${file}`;
    const canonicalUrl = `https://huggingface.co/${definition.repo}/resolve/${definition.canonicalRevision}/${file}`;
    let sha256 = metadataFile.lfs?.sha256;
    let size = metadataFile.size;
    if (!sha256) {
      const hashed = await sha256Response(await fetch(sourceUrl));
      sha256 = hashed.sha256;
      size = hashed.size;
    }
    assets.push({
      localPath: `${definition.id}/${file}`,
      sourceUrl,
      canonicalUrl,
      size,
      sha256
    });
  }
  return {
    id: definition.id,
    label: definition.label,
    kind: definition.kind,
    repo: definition.repo,
    revision: definition.revision,
    bytes: assets.reduce((total, asset) => total + asset.size, 0),
    assets
  };
}

const models = [];
for (const definition of definitions) models.push(await buildHuggingFaceModel(definition));

const wasmUrl = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/5b7251f3bdce957be2a7bf73a6f6c560d9874df4/web-llm-models/v0_2_87/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm";
const wasm = await sha256Response(await fetch(wasmUrl));
const llm = models.find(model => model.id === "llm");
llm.assets.push({
  localPath: "llm/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm",
  sourceUrl: wasmUrl,
  canonicalUrl: wasmUrl,
  size: wasm.size,
  sha256: wasm.sha256
});
llm.bytes += wasm.size;

const manifest = {
  schemaVersion: 1,
  version: manifestVersion,
  generatedAt: new Date().toISOString(),
  modelBaseUrlEnvironmentVariable: "VITE_MODEL_BASE_URL",
  models
};

await writeFile(resolve(root, "public", "model-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote model manifest ${manifestVersion} with ${models.reduce((n, model) => n + model.assets.length, 0)} verified assets.`);
