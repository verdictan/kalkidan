import type { TrackerAuthState, TrackerField } from './tracker';
export interface GitHubRepository {
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  isArchived: boolean;
}
export interface GitHubOwner {
  id: string;
  login: string;
  kind: 'user' | 'organization';
}
export type GitHubAuthState = TrackerAuthState;
export interface GitHubProject {
  id: string;
  title: string;
  url: string;
  owner: string;
  number: number;
  statusFieldId?: string;
}
export interface GitHubItem {
  id: string;
  title: string;
  body: string;
  url?: string;
  repository?: string;
  number?: number;
  status?: string;
  statusId?: string;
  kind?: string;
  archived?: boolean;
  fieldValues?: Record<string, unknown>[];
}
export interface GitHubBoard {
  cache?: { revision: string; fetchedAt: number };
  project: GitHubProject;
  items: GitHubItem[];
  archivedItems?: GitHubItem[];
  restrictedItems?: number;
  writable?: boolean;
  fields?: TrackerField[];
  statusField?: { id: string; options: { id: string; name: string }[] };
}
