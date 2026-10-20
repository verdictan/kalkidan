interface Entry<T> {
  value?: T;
  expires: number;
  bytes: number;
  pending?: Promise<T>;
}
/** Shared backend reads with bounded memory and generation-safe invalidation. */
export class ResourceCache<T> {
  private entries = new Map<string, Entry<T>>();
  readonly metrics = { hits: 0, misses: 0, coalesced: 0, invalidations: 0 };
  constructor(
    private ttl = 60000,
    private capacity = 32,
    private byteLimit = 16 * 1024 * 1024,
    private now = Date.now,
  ) {}
  invalidate(key?: string) {
    this.metrics.invalidations++;
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
  async read(key: string, fetch: () => Promise<T>, force = false): Promise<T> {
    let entry = this.entries.get(key);
    if (entry?.pending) {
      this.metrics.coalesced++;
      return structuredClone(await entry.pending);
    }
    if (force) {
      this.invalidate(key);
      entry = undefined;
    }
    if (entry?.value !== undefined && entry.expires > this.now()) {
      this.metrics.hits++;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return structuredClone(entry.value);
    }
    this.metrics.misses++;
    entry = { expires: 0, bytes: 0 };
    const current = entry;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.trim();
    const task = Promise.resolve()
      .then(fetch)
      .then((value) => {
        if (this.entries.get(key) === current) {
          current.value = structuredClone(value);
          current.bytes = Buffer.byteLength(JSON.stringify(value));
          current.expires = this.now() + this.ttl;
          current.pending = undefined;
          this.trim();
        }
        return value;
      })
      .catch((error) => {
        if (this.entries.get(key) === current) this.entries.delete(key);
        throw error;
      });
    entry.pending = task;
    return structuredClone(await task);
  }
  private trim() {
    let size = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.capacity && size <= this.byteLimit) break;
      this.entries.delete(key);
      size -= entry.bytes;
    }
  }
}
