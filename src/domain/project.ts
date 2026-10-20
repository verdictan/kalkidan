import type { GitHubProject } from './github';
import type { TrackerConnection } from './tracker';
import type { Session } from './conversation';
export interface RemoteHost {
  id: string;
  name: string;
  target: string;
  status: 'disconnected' | 'checked' | 'connecting' | 'connected' | 'error';
  /**
   * Why the last check or connection failed, or why the connection closed. It is cleared when
   * the host connects. Call remoteConnect again to reconnect.
   */
  error?: string;
  version?: string;
  node?: string;
  platform?: string;
}
export interface RemoteFolders {
  path: string;
  parent: string;
  folders: { name: string; path: string }[];
}
export interface ProjectGroup {
  rootPath?: string;
  color?: import('./project-colors').ProjectColor;
  hostId?: string;
  id: string;
  name: string;
  repoIds: string[];
  github?: GitHubProject;
  tracker?: TrackerConnection;
}
export interface Project {
  hostId?: string;
  id: string;
  name: string;
  path: string;
  favorite: boolean;
  notes: string;
  addedAt: string;
}
export interface GitInfo {
  branch: string;
  changes: number;
  worktrees: { path: string; branch: string }[];
}
export interface Snapshot {
  hosts?: RemoteHost[];
  projects: Project[];
  groups?: ProjectGroup[];
  sessions: Session[];
  warnings: string[];
  platform: string;
}

export interface RepositorySnapshot {
  git: GitInfo | null;
  sessions: Session[];
  warnings: string[];
}

export interface DirectoryListing {
  path: string;
  parent: string;
  entries: { name: string; path: string; kind: 'directory' | 'symlink' | 'file' }[];
}
