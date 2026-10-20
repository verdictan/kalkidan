import type { Project, Session } from '../types';

// Match the nearest checkout, not its parent when a worktree lives inside another.
export function worktreeSessions(
  path: string,
  trees: { path: string }[],
  sessions: Session[],
  hostId?: string,
) {
  const ordered = [...trees].sort((a, b) => b.path.length - a.path.length);
  return sessions
    .filter(
      (session) =>
        session.hostId === hostId &&
        ordered.find(
          (tree) =>
            session.cwd === tree.path || session.cwd.startsWith(tree.path.replace(/\/$/, '') + '/'),
        )?.path === path,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const inWorktrees = (path: string) => path.slice(0, path.lastIndexOf('/')).endsWith('/worktrees');

/**
 * A branch copy that Kalkidan created lives in
 * `<project folder>/worktrees/<repository>-<branch>-<id>`. Returns the repository that the
 * branch copy belongs to, if `siblings` has it.
 */
export function worktreeParent(repo: Project, siblings: Project[]) {
  if (repo.path.lastIndexOf('/') < 0 || !inWorktrees(repo.path)) return undefined;
  const folder = folderName(repo.path);
  let parent: Project | undefined;
  let best = 0;
  for (const candidate of siblings) {
    if (candidate.id === repo.id || candidate.hostId !== repo.hostId) continue;
    if (inWorktrees(candidate.path)) continue;
    const name = folderName(candidate.path);
    if (folder.startsWith(name + '-') && name.length > best) {
      parent = candidate;
      best = name.length;
    }
  }
  return parent;
}

/**
 * The branch name of a branch copy, from its folder name. Kalkidan replaces "/" with "-" and
 * adds an 8-character ID or a number at the end.
 */
export function worktreeBranch(repo: Project, parent: Project) {
  const rest = folderName(repo.path).slice(folderName(parent.path).length + 1);
  return rest.replace(/-(?:[0-9a-f]{8}|\d+)$/, '') || rest || repo.name;
}
