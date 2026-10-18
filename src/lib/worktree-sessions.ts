import type { Session } from '../types';

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
