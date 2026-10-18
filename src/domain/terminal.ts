export interface TerminalRun {
  id: string;
  command: string;
  cwd: string;
  output: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  exitCode?: number | null;
  truncated: boolean;
}
export interface RepositoryDiff {
  unstaged: string;
  staged: string;
  untracked: string[];
  newFiles?: { path: string; text?: string; reason?: string; truncated?: boolean }[];
  truncated: boolean;
}
