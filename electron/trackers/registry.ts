import type { DocsIssuePlan, DocsIssuePlanResult } from '../../src/domain/docs-plan';
import type {
  GitHubMutationHistory,
  ProjectBatchRequest,
  ProjectBatchResult,
} from '../../src/domain/project-batch';
import type { GitHubContentSnapshot, GitHubContentAction } from '../../src/domain/github-content';
import type { IssueRelations, IssueRelationAction } from '../../src/domain/github-relations';
import type {
  SavedProjectView,
  ProjectResourceKind,
  ProjectResourceOperation,
  ProjectResourceSnapshot,
} from '../../src/domain/github-resources';
import type {
  ProjectFieldValue,
  ProjectItemAction,
  ProjectAdminAction,
  ProjectAdminResult,
  ProjectSettings,
  ProjectSettingsAction,
} from '../../src/domain/github-mutations';
import type {
  TrackerAuthState,
  TrackerBoard,
  TrackerDescriptor,
  TrackerOwner,
  TrackerProject,
  TrackerConnection,
} from '../../src/domain/tracker';
export interface TrackerProvider {
  portfolio?(projects: TrackerProject[]): Promise<{ board?: TrackerBoard; error?: string }[]>;
  docsPlan?(project: TrackerProject, plan: DocsIssuePlan): Promise<DocsIssuePlanResult>;
  mutationHistory?(project: TrackerProject, reviewedId?: string): Promise<GitHubMutationHistory>;
  revertMutation?(project: TrackerProject, mutationId: string): Promise<string>;
  batch?(project: TrackerProject, request: ProjectBatchRequest): Promise<ProjectBatchResult>;
  savedView?(project: TrackerProject, viewId: string): Promise<SavedProjectView>;
  content?(project: TrackerProject, item: string): Promise<GitHubContentSnapshot>;
  contentChange?(
    project: TrackerProject,
    item: string,
    revision: string,
    action: GitHubContentAction,
  ): Promise<GitHubContentSnapshot>;
  relations?(project: TrackerProject, item: string): Promise<IssueRelations>;
  relationChange?(
    project: TrackerProject,
    item: string,
    revision: string,
    action: IssueRelationAction,
  ): Promise<IssueRelations>;
  resources?(project: TrackerProject, kind: ProjectResourceKind): Promise<ProjectResourceSnapshot>;
  resourceChange?(
    project: TrackerProject,
    revision: string,
    operation: ProjectResourceOperation,
    input: Record<string, unknown>,
  ): Promise<ProjectResourceSnapshot>;

  projectAction?(
    project: TrackerProject,
    revision: string,
    action: ProjectAdminAction,
  ): Promise<ProjectAdminResult>;
  settings?(project: TrackerProject): Promise<ProjectSettings>;
  settingsUpdate?(
    project: TrackerProject,
    revision: string,
    action: ProjectSettingsAction,
  ): Promise<ProjectSettings>;

  field?(
    project: TrackerProject,
    item: string,
    field: string,
    value: ProjectFieldValue,
  ): Promise<void>;
  itemAction?(project: TrackerProject, item: string, action: ProjectItemAction): Promise<void>;
  descriptor: TrackerDescriptor;
  authorize(force?: boolean): Promise<TrackerAuthState>;
  authStatus(): TrackerAuthState | Promise<TrackerAuthState>;
  cancelAuth(attemptId: string): TrackerAuthState | Promise<TrackerAuthState>;
  openAuth(): Promise<void>;
  owners(): Promise<TrackerOwner[]>;
  projects(owner: TrackerOwner): Promise<TrackerProject[]>;
  resolve(reference: string): Promise<TrackerProject>;
  createProject(owner: TrackerOwner, title: string): Promise<TrackerProject>;
  board(project: TrackerProject, force?: boolean): Promise<TrackerBoard>;
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
    return {
      provider: this.get(connection.provider),
      project: connection.statusFieldId
        ? { ...connection.project, statusFieldId: connection.statusFieldId }
        : connection.project,
    };
  }
  require(id: string, capability: keyof TrackerDescriptor['capabilities']) {
    const provider = this.get(id);
    if (!provider.descriptor.capabilities[capability])
      throw new Error(`${provider.descriptor.name} does not support ${capability}.`);
    return provider;
  }
}
