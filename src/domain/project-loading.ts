/** Shared loading states keep cached details visible while a request is in progress. */
export type ProjectLoadState<T> =
  | { status: 'idle'; value?: undefined; error?: undefined }
  | { status: 'loading'; value?: undefined; error?: undefined }
  | { status: 'ready' | 'refreshing'; value: T; error?: undefined }
  | { status: 'error'; value?: T; error: string };

interface Entry<T> {
  state: ProjectLoadState<T>;
  expires: number;
  pending?: Promise<void>;
  bytes?: number;
}
const idle = { status: 'idle' } as const;

export class ProjectLoadCache<T> {
  private entries = new Map<string, Entry<T>>();
  private listeners = new Set<() => void>();
  constructor(
    private ttl = 15000,
    private capacity = 24,
    private now = Date.now,
    private byteLimit = Infinity,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  read(key: string): ProjectLoadState<T> {
    return this.entries.get(key)?.state ?? idle;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, {
      state: { status: 'ready', value },
      expires: this.now() + this.ttl,
      bytes: Number.isFinite(this.byteLimit)
        ? new TextEncoder().encode(JSON.stringify(value)).byteLength
        : 0,
    });
    this.trim(key);
    this.emit();
  }
  private trim(keep: string) {
    let total = [...this.entries.values()].reduce((sum, e) => sum + (e.bytes || 0), 0);
    for (const [key, cached] of this.entries) {
      if (total <= this.byteLimit && this.entries.size <= this.capacity) break;
      if (key === keep) continue;
      this.entries.delete(key);
      total -= cached.bytes || 0;
    }
    const current = this.entries.get(keep);
    if (current && total > this.byteLimit) current.expires = 0;
  }
  invalidate(key?: string) {
    this.invalidateWhere((entryKey) => key === undefined || key === entryKey);
  }
  invalidateWhere(match: (key: string) => boolean) {
    // Detach pending requests. A response from before a mutation must not replace newer data.
    for (const [entryKey, entry] of this.entries) {
      if (!match(entryKey)) continue;
      this.entries.set(entryKey, {
        expires: 0,
        bytes: entry.bytes,
        state:
          entry.state.value === undefined ? idle : { status: 'ready', value: entry.state.value },
      });
    }
    this.emit();
  }
  removeWhere(match: (key: string) => boolean) {
    let changed = false;
    for (const key of this.entries.keys())
      if (match(key)) {
        this.entries.delete(key);
        changed = true;
      }
    if (changed) this.emit();
  }
  retain(keys: Set<string>) {
    for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key);
    this.emit();
  }
  load(key: string, fetch: () => Promise<T>, force = false): Promise<void> {
    let entry = this.entries.get(key);
    if (entry?.pending) return entry.pending;
    if (!force && entry?.state.status === 'ready' && entry.expires > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return Promise.resolve();
    }
    const value = entry?.state.value;
    const bytes = entry?.bytes;
    entry = {
      expires: 0,
      bytes,
      state: value === undefined ? { status: 'loading' } : { status: 'refreshing', value },
    };
    const current = entry;
    this.entries.delete(key);
    this.entries.set(key, current);
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    current.pending = Promise.resolve()
      .then(fetch)
      .then(
        (result) => {
          if (this.entries.get(key) !== current) return;
          current.state = { status: 'ready', value: result };
          current.expires = this.now() + this.ttl;
          if (Number.isFinite(this.byteLimit)) {
            current.bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
            // The active response remains available for rendering. Drop all older cached bodies.
            this.trim(key);
          }
        },
        (error: unknown) => {
          if (this.entries.get(key) !== current) return;
          current.state = {
            status: 'error',
            value,
            error: error instanceof Error ? error.message : String(error),
          };
        },
      )
      .finally(() => {
        current.pending = undefined;
        if (this.entries.get(key) === current) this.emit();
      });
    this.emit();
    return current.pending;
  }
}
