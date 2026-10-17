export type Agent = 'codex' | 'claude';
export interface Project { id: string; name: string; path: string; favorite: boolean; notes: string; addedAt: string }
export interface Session { id: string; agent: Agent; cwd: string; updatedAt: string; title: string }
export interface GitInfo { branch: string; changes: number; worktrees: { path: string; branch: string }[] }
export interface Snapshot { projects: Project[]; sessions: Session[]; warnings: string[]; platform: string }
export interface API {
  snapshot(): Promise<Snapshot>;
  add(): Promise<void>;
  discover(): Promise<{ added: number }>;
  update(id: string, changes: { name?: string; favorite?: boolean; notes?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  git(id: string): Promise<GitInfo | null>;
  launch(id: string, agent: Agent | 'terminal', sessionId?: string): Promise<void>;
  reveal(id: string): Promise<void>;
  worktree(id: string, branch: string): Promise<boolean>;
}
declare global { interface Window { workspace?: API } }
