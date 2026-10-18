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
export interface GitHubAuthState {
  status: 'idle' | 'checking' | 'waiting' | 'ready' | 'error';
  code?: string;
  message?: string;
}
export interface GitHubProject {
  id: string;
  title: string;
  url: string;
  owner: string;
  number: number;
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
}
export interface GitHubBoard {
  project: GitHubProject;
  items: GitHubItem[];
  statusField?: { id: string; options: { id: string; name: string }[] };
}
