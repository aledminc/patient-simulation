const KEY = "patient-simulator.aggregate-diagnostics.v1";

function empty() {
  return { schemaVersion: 1, stages: {}, encounters: 0, crashes: 0 };
}

export class AggregateDiagnostics {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    try { this.data = JSON.parse(storage?.getItem(KEY) || "null") || empty(); } catch { this.data = empty(); }
  }

  record(stage, durationMs, { success = true } = {}) {
    const current = this.data.stages[stage] || { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    if (!success) current.failures += 1;
    const safeDuration = Math.max(0, Math.round(Number(durationMs) || 0));
    current.totalMs += safeDuration;
    current.maxMs = Math.max(current.maxMs, safeDuration);
    this.data.stages[stage] = current;
    this.#save();
  }

  encounterComplete() {
    this.data.encounters += 1;
    this.#save();
  }

  recoveredError() {
    this.data.crashes += 1;
    this.#save();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  clear() {
    this.data = empty();
    this.#save();
  }

  #save() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch {}
  }
}

