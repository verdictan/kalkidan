import type { Session, Project } from '../types';
export function sessionRepo(session: Pick<Session, 'cwd' | 'hostId'>, repos: Project[]) {
  return repos
    .filter(
      (repo) =>
        repo.hostId === session.hostId &&
        (session.cwd === repo.path || session.cwd.startsWith(repo.path.replace(/\/$/, '') + '/')),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}
/**
 * The chats of a project that a person can open, newest first: not archived and not an unsent
 * draft. The sidebar, the project Chats tab, All chats and the overview count these chats, so
 * their counts agree.
 */
export function projectSessions(
  sessions: Session[],
  group: { repoIds: string[] },
  repos: Project[],
) {
  return sessions
    .filter(
      (s) =>
        !s.organization?.archived &&
        !s.id.startsWith('draft-') &&
        group.repoIds.includes(sessionRepo(s, repos)?.id || ''),
    )
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
