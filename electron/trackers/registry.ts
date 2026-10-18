import type {
  TrackerAuthState,
  TrackerBoard,
  TrackerDescriptor,
  TrackerOwner,
  TrackerProject,
  TrackerConnection,
} from '../../src/domain/tracker';
export interface TrackerProvider {
  descriptor: TrackerDescriptor;
  authorize(force?: boolean): Promise<TrackerAuthState>;
  authStatus(): TrackerAuthState | Promise<TrackerAuthState>;
  cancelAuth(): TrackerAuthState | Promise<TrackerAuthState>;
  openAuth(): Promise<void>;
  owners(): Promise<TrackerOwner[]>;
  projects(owner: TrackerOwner): Promise<TrackerProject[]>;
  resolve(reference: string): Promise<TrackerProject>;
  createProject(owner: TrackerOwner, title: string): Promise<TrackerProject>;
  board(project: TrackerProject): Promise<TrackerBoard>;
  setStatus(project: TrackerProject, item: string, status: string): Promise<void>;
  createItem(project: TrackerProject, title: string, body: string): Promise<string | void>;
  importItem(project: TrackerProject, reference: string): Promise<void>;
}
/** Explicit registration, no dynamic code loading or provider selection from URLs. */
export class TrackerRegistry {
  private providers = new Map<string, TrackerProvider>();
  constructor(
    providers: TrackerProvider[],
    readonly defaultProvider = 'github',
  ) {
    for (const provider of providers) {
      const id = provider.descriptor.id;
      if (!/^[a-z][a-z0-9-]*$/.test(id) || this.providers.has(id))
        throw new Error(`Invalid or duplicate tracker provider: ${id}`);
      this.providers.set(id, provider);
    }
    this.get(defaultProvider);
  }
  list() {
    return [
      this.get(this.defaultProvider),
      ...[...this.providers.values()].filter((p) => p.descriptor.id !== this.defaultProvider),
    ].map((p) => structuredClone(p.descriptor));
  }
  get(id: string) {
    const provider = this.providers.get(id);
    if (!provider)
      throw new Error(`Tracker provider “${id}” is unavailable. Enable its adapter to continue.`);
    return provider;
  }
  linked(connection: TrackerConnection | undefined) {
    if (!connection) throw new Error('Connect a project tracker first.');
    return { provider: this.get(connection.provider), project: connection.project };
  }
  require(id: string, capability: keyof TrackerDescriptor['capabilities']) {
    const provider = this.get(id);
    if (!provider.descriptor.capabilities[capability])
      throw new Error(`${provider.descriptor.name} does not support ${capability}.`);
    return provider;
  }
}
