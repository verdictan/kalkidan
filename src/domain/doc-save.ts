import type { ProjectDoc } from './docs';

export type DocSaveState = {
  status: 'clean' | 'dirty' | 'saving' | 'save-error' | 'conflict' | 'deleted';
  draft: ProjectDoc;
  error?: string;
};

/** One owner serializes page writes and keeps the newest unsaved text on failure. */
export class DocSaveMachine {
  private state: DocSaveState;
  private revision: string;
  private listeners = new Set<() => void>();
  private pending?: Promise<void>;
  private editVersion = 0;
  constructor(
    initial: ProjectDoc,
    private save: (doc: ProjectDoc) => Promise<ProjectDoc>,
    private saved: (doc: ProjectDoc) => void,
    private persist: (doc: ProjectDoc | null) => void,
  ) {
    this.state = { status: 'clean', draft: initial };
    this.revision = initial.revision;
  }
  read = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: DocSaveState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  edit(draft: ProjectDoc) {
    this.editVersion++;
    this.persist(draft);
    const blocked = this.state.status === 'conflict' || this.state.status === 'deleted';
    this.set({ ...this.state, draft, status: blocked ? this.state.status : 'dirty' });
  }
  refresh(doc: ProjectDoc) {
    if (this.state.status !== 'clean' || this.pending || doc.revision === this.revision) return;
    this.revision = doc.revision;
    this.set({ status: 'clean', draft: doc });
  }
  flush(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state.status !== 'dirty') return Promise.resolve();
    this.pending = this.write().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async write() {
    while (this.state.status === 'dirty') {
      const value = this.state.draft;
      const version = this.editVersion;
      this.set({ status: 'saving', draft: value });
      try {
        const result = await this.save({
          ...value,
          title: value.title.trim() || 'Untitled',
          revision: this.revision,
        });
        this.revision = result.revision;
        this.saved(result);
        if (version === this.editVersion) {
          this.persist(null);
          this.set({ status: 'clean', draft: result });
        } else {
          this.set({ status: 'dirty', draft: this.state.draft });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.set({
          draft: this.state.draft,
          error: message,
          status: /DOC_CONFLICT|changed on disk/.test(message)
            ? 'conflict'
            : /DOC_DELETED|ENOENT/.test(message)
              ? 'deleted'
              : 'save-error',
        });
        return;
      }
    }
  }
  retry() {
    if (this.state.status === 'save-error') this.set({ status: 'dirty', draft: this.state.draft });
    return this.flush();
  }
  restore(doc: ProjectDoc) {
    if (this.pending) throw new Error('Wait for the current save to finish.');
    this.revision = doc.revision;
    this.set({ status: 'dirty', draft: doc });
    this.edit(doc);
  }
  /** The caller must obtain an explicit discard action before it uses this method. */
  discard(doc: ProjectDoc) {
    if (this.pending) throw new Error('Wait for the current save to finish.');
    this.editVersion++;
    this.revision = doc.revision;
    this.persist(null);
    this.set({ status: 'clean', draft: doc });
  }
}
