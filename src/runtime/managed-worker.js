export class WorkerRequestError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.name = "WorkerRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class ManagedWorker {
  constructor(name, workerFactory, { defaultTimeoutMs = 30_000, onEvent = () => {} } = {}) {
    this.name = name;
    this.workerFactory = workerFactory;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.onEvent = onEvent;
    this.nextId = 1;
    this.pending = new Map();
    this.worker = null;
    this.generation = 0;
  }

  request(type, payload = {}, { timeoutMs = this.defaultTimeoutMs, transfer = [], signal } = {}) {
    if (signal?.aborted) return Promise.reject(new DOMException("Operation cancelled.", "AbortError"));
    this.#ensureWorker();
    const id = `${this.name}-${this.generation}-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkerRequestError("WORKER_TIMEOUT", `${this.name} did not respond within ${timeoutMs} ms.`));
        this.restart("timeout");
      }, timeoutMs);
      const abort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new DOMException("Operation cancelled.", "AbortError"));
        this.restart("cancelled");
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener("abort", abort)
      });
      try {
        this.worker.postMessage({ id, type, payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new WorkerRequestError("WORKER_POST_FAILED", String(error?.message || error)));
        this.restart("post-failed");
      }
    });
  }

  restart(reason = "manual") {
    this.worker?.terminate();
    this.worker = null;
    this.generation += 1;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(new WorkerRequestError("WORKER_RESTARTED", `${this.name} restarted after ${reason}.`));
    }
    this.pending.clear();
    this.onEvent({ type: "restart", worker: this.name, reason });
  }

  dispose() {
    this.restart("disposed");
  }

  #ensureWorker() {
    if (this.worker) return;
    const worker = this.workerFactory();
    this.worker = worker;
    worker.onmessage = event => this.#onMessage(event.data);
    worker.onerror = event => {
      event.preventDefault?.();
      this.restart("uncaught-error");
    };
    worker.onmessageerror = () => this.restart("message-error");
    this.onEvent({ type: "start", worker: this.name });
  }

  #onMessage(message) {
    if (message?.type === "event") {
      this.onEvent({ worker: this.name, ...message.event });
      return;
    }
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.cleanup();
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new WorkerRequestError(message.error?.code || "WORKER_ERROR", message.error?.message || `${this.name} failed.`, message.error?.retryable !== false));
  }
}
