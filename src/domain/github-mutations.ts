import type { PortfolioProject } from './project-portfolio';
import type { DocsIssuePlan, DocsIssuePlanResult } from './docs-plan';
import type {
  GitHubMutationHistory,
  ProjectBatchRequest,
  ProjectBatchResult,
} from './project-batch';
/** GitHub Projects writes use opaque IDs and one value per field mutation. */
export type ProjectFieldValue =
  | { text: string }
  | { number: number }
  | { date: string }
  | { singleSelectOptionId: string }
  | { multiSelectOptionIds: string[] }
  | { iterationId: string }
  | null;
export type ProjectItemAction =
  | { kind: 'archive' }
  | { kind: 'unarchive' }
  | { kind: 'remove' }
  | { kind: 'edit-draft'; title: string; body: string }
  | { kind: 'convert'; repository: string }
  | { kind: 'reorder'; afterId: string | null };
export type ProjectAdminAction =
  | { kind: 'copy'; owner: string; title: string; includeDraftIssues: boolean }
  | { kind: 'delete'; confirmation: string }
  | { kind: 'team'; organization: string; slug: string; linked: boolean }
  | { kind: 'collaborator'; user: string; role: 'NONE' | 'READER' | 'WRITER' | 'ADMIN' }
  | {
      kind: 'team-collaborator';
      organization: string;
      slug: string;
      role: 'NONE' | 'READER' | 'WRITER' | 'ADMIN';
    };
export interface ProjectAdminResult {
  deleted?: boolean;
  url?: string;
}
export interface GitHubProjectMutationAPI {
  trackerPortfolio(groupIds: string[]): Promise<PortfolioProject[]>;
  trackerDocsPlan(groupId: string, plan: DocsIssuePlan): Promise<DocsIssuePlanResult>;
  trackerMutationHistory(groupId: string, reviewedId?: string): Promise<GitHubMutationHistory>;
  /** Writes the values from before a confirmed field change. Returns the new write's ID. */
  trackerMutationRevert(groupId: string, mutationId: string): Promise<string>;
  trackerBatch(groupId: string, request: ProjectBatchRequest): Promise<ProjectBatchResult>;
  trackerProjectAction(
    groupId: string,
    revision: string,
    action: ProjectAdminAction,
  ): Promise<ProjectAdminResult>;

  trackerSettings(groupId: string): Promise<ProjectSettings>;
  trackerSettingsUpdate(
    groupId: string,
    revision: string,
    action: ProjectSettingsAction,
  ): Promise<ProjectSettings>;

  trackerField(
    groupId: string,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ): Promise<void>;
  trackerItemAction(groupId: string, itemId: string, action: ProjectItemAction): Promise<void>;
}

export interface ProjectSettings {
  id: string;
  title: string;
  shortDescription: string;
  readme: string;
  closed: boolean;
  public: boolean;
  template: boolean;
  writable: boolean;
  revision: string;
  teams?: { id: string; name: string; slug: string; organization: string }[];
  repositories: { id: string; nameWithOwner: string }[];
}
export type ProjectSettingsAction =
  | {
      kind: 'update';
      title: string;
      shortDescription: string;
      readme: string;
      closed: boolean;
      public: boolean;
    }
  | { kind: 'template'; enabled: boolean }
  | { kind: 'repository'; nameWithOwner: string; linked: boolean };
