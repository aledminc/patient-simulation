export class QueueFullError extends Error {
  constructor(message = "The inference queue is full. Wait for the current operation to finish.") {
    super(message);
    this.name = "QueueFullError";
    this.code = "QUEUE_FULL";
  }
}

export class InferenceQueue {
  constructor({ maxPending = 2, onStateChange = () => {} } = {}) {
    this.maxPending = maxPending;
    this.onStateChange = onStateChange;
    this.pending = [];
    this.running = null;
  }

  get size() {
    return this.pending.length + (this.running ? 1 : 0);
  }

  enqueue(label, operation, { signal } = {}) {
    if (this.size >= this.maxPending + 1) return Promise.reject(new QueueFullError());
    return new Promise((resolve, reject) => {
      const item = { label, operation, resolve, reject, signal, cancelled: false };
      if (signal?.aborted) {
        reject(new DOMException("Operation cancelled.", "AbortError"));
        return;
      }
      const abort = () => {
        item.cancelled = true;
        if (this.running !== item) {
          this.pending = this.pending.filter(candidate => candidate !== item);
          reject(new DOMException("Operation cancelled.", "AbortError"));
          this.#notify();
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      item.cleanup = () => signal?.removeEventListener("abort", abort);
      this.pending.push(item);
      this.#notify();
      void this.#drain();
    });
  }

  async #drain() {
    if (this.running || !this.pending.length) return;
    const item = this.pending.shift();
    this.running = item;
    this.#notify();
    try {
      if (item.cancelled || item.signal?.aborted) throw new DOMException("Operation cancelled.", "AbortError");
      item.resolve(await item.operation(item.signal));
    } catch (error) {
      item.reject(error);
    } finally {
      item.cleanup?.();
      this.running = null;
      this.#notify();
      void this.#drain();
    }
  }

  #notify() {
    this.onStateChange({ running: this.running?.label || null, pending: this.pending.map(item => item.label) });
  }
}
