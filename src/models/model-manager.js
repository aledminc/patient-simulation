import { ManagedWorker } from "../runtime/managed-worker.js";
import { loadModelManifest, modelById } from "./model-registry.js";

const METADATA_KEY = "patient-simulator.model-status.v1";

function readMetadata(storage) {
  try { return JSON.parse(storage?.getItem(METADATA_KEY) || "{}"); } catch { return {}; }
}

export class ModelManager {
  constructor({ storage = globalThis.localStorage, baseUrl = import.meta.env.VITE_MODEL_BASE_URL || "", workerFactory, onChange = () => {} } = {}) {
    this.storage = storage;
    this.baseUrl = baseUrl;
    this.onChange = onChange;
    this.manifest = null;
    this.metadata = readMetadata(storage);
    this.status = {};
    this.worker = new ManagedWorker("model-manager", workerFactory || (() => new Worker(new URL("../workers/model-manager.worker.js", import.meta.url), { type: "module" })), {
      defaultTimeoutMs: 30 * 60_000,
      onEvent: event => this.#onWorkerEvent(event)
    });
  }

  async initialize() {
    this.manifest = await loadModelManifest();
    if (this.metadata.manifestVersion !== this.manifest.version) {
      this.metadata = { manifestVersion: this.manifest.version, models: {} };
      this.#persist();
    }
    for (const model of this.manifest.models) {
      const previous = this.metadata.models?.[model.id];
      this.status[model.id] = { state: previous?.verified ? "checking" : "not-installed", progress: 0, error: null };
      if (previous?.verified) {
        try {
          const result = await this.worker.request("inventory", { model }, { timeoutMs: 20_000 });
          this.status[model.id] = { state: result.complete ? "ready" : "needs-repair", progress: result.complete ? 1 : 0, error: null };
        } catch {
          this.status[model.id] = { state: "needs-repair", progress: 0, error: "Unable to inspect the cached model." };
        }
      }
    }
    this.#emit();
    return this.snapshot();
  }

  snapshot() {
    return {
      manifestVersion: this.manifest?.version || null,
      source: this.baseUrl || "Pinned public model repositories",
      models: Object.fromEntries(Object.entries(this.status).map(([id, value]) => [id, { ...value }])),
      definitions: this.manifest?.models.map(model => ({ id: model.id, label: model.label, bytes: model.bytes })) || []
    };
  }

  isReady(modelId) {
    return this.status[modelId]?.state === "ready";
  }

  async download(modelId, { repair = false, signal } = {}) {
    const model = modelById(this.manifest, modelId);
    this.status[modelId] = { state: repair ? "repairing" : "downloading", progress: 0, error: null };
    this.#emit();
    try {
      await this.worker.request(repair ? "repair" : "download", {
        model,
        manifestVersion: this.manifest.version,
        baseUrl: this.baseUrl
      }, { signal, timeoutMs: 30 * 60_000 });
      this.status[modelId] = { state: "ready", progress: 1, error: null };
      this.metadata.models ||= {};
      this.metadata.models[modelId] = { verified: true, verifiedAt: new Date().toISOString() };
      this.#persist();
      this.#emit();
    } catch (error) {
      this.status[modelId] = {
        state: error?.name === "AbortError" || error?.code === "DOWNLOAD_CANCELLED" ? "not-installed" : "error",
        progress: 0,
        error: String(error?.message || error)
      };
      this.#emit();
      throw error;
    }
  }

  async downloadMany(modelIds, { signal } = {}) {
    for (const modelId of modelIds) {
      if (signal?.aborted) throw new DOMException("Download cancelled.", "AbortError");
      if (!this.isReady(modelId)) await this.download(modelId, { signal });
    }
  }

  async repair(modelId, options = {}) {
    return this.download(modelId, { ...options, repair: true });
  }

  async remove(modelId) {
    const model = modelById(this.manifest, modelId);
    await this.worker.request("remove", { model }, { timeoutMs: 60_000 });
    this.status[modelId] = { state: "not-installed", progress: 0, error: null };
    if (this.metadata.models) delete this.metadata.models[modelId];
    this.#persist();
    this.#emit();
  }

  dispose() {
    this.worker.dispose();
  }

  #onWorkerEvent(event) {
    if (event.type !== "progress" || !event.modelId || !this.status[event.modelId]) return;
    this.status[event.modelId] = {
      ...this.status[event.modelId],
      progress: event.total ? Math.min(1, event.completed / event.total) : 0,
      file: event.file
    };
    this.#emit();
  }

  #persist() {
    try { this.storage?.setItem(METADATA_KEY, JSON.stringify(this.metadata)); } catch {}
  }

  #emit() {
    this.onChange(this.snapshot());
  }
}
