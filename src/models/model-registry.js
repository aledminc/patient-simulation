let manifestPromise = null;

export function resolveModelSource(asset, manifest, baseUrl = import.meta.env.VITE_MODEL_BASE_URL || "") {
  const trimmed = String(baseUrl || "").replace(/\/$/, "");
  return trimmed ? `${trimmed}/${manifest.version}/${asset.localPath}` : asset.sourceUrl;
}

export async function loadModelManifest(fetchImpl = fetch) {
  if (!manifestPromise || fetchImpl !== fetch) {
    manifestPromise = fetchImpl("/model-manifest.json", { cache: "no-cache" }).then(async response => {
      if (!response.ok) throw new Error(`Unable to load model manifest: HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.models)) throw new Error("The model manifest is invalid.");
      return Object.freeze(manifest);
    });
  }
  return manifestPromise;
}

export function modelById(manifest, modelId) {
  const model = manifest.models.find(candidate => candidate.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

export function hexToSri(hex) {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map(value => Number.parseInt(value, 16)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

export function webLlmConfiguration(manifest) {
  const llm = modelById(manifest, "llm");
  const asset = path => llm.assets.find(item => item.localPath.endsWith(path));
  const modelBase = `https://huggingface.co/${llm.repo}/resolve/${llm.revision}/`;
  const wasm = asset(".wasm");
  return {
    modelId: "Qwen3-0.6B-q4f16_1-MLC",
    modelRecord: {
      model: modelBase,
      model_id: "Qwen3-0.6B-q4f16_1-MLC",
      model_lib: wasm.canonicalUrl,
      vram_required_MB: 1403.34,
      low_resource_required: true,
      overrides: { context_window_size: 1024, enable_thinking: false },
      integrity: {
        config: hexToSri(asset("mlc-chat-config.json").sha256),
        model_lib: hexToSri(wasm.sha256),
        tokenizer: {
          "tokenizer.json": hexToSri(asset("tokenizer.json").sha256),
          "tokenizer_config.json": hexToSri(asset("tokenizer_config.json").sha256)
        },
        onFailure: "error"
      }
    }
  };
}

