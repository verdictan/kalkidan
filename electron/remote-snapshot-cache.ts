/** Keep remote scans out of the library request path. */
export class RemoteSnapshotCache<T> {
  private entries = new Map<
    string,
    { value?: T; error?: string; expires: number; pending?: Promise<void> }
  >();
  constructor(
    private changed: () => void,
    private now = Date.now,
  ) {}
  read(id: string, fetch: () => Promise<T>) {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { expires: 0 };
      this.entries.set(id, entry);
    }
    const current = entry;
    if (!entry.pending && entry.expires <= this.now()) {
      entry.pending = Promise.resolve()
        .then(fetch)
        .then(
          (value) => {
            current.value = value;
            delete current.error;
          },
          (error) => {
            current.error = String(error?.message || error);
          },
        )
        .finally(() => {
          current.pending = undefined;
          current.expires = this.now() + 15000;
          if (this.entries.get(id) === current) this.changed();
        });
    }
    return { value: entry.value, error: entry.error };
  }
  /** The last value of a host, without a new scan. */
  peek(id: string) {
    return this.entries.get(id)?.value;
  }
  retain(ids: Set<string>) {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }
}
