import type { Session, Project } from '../types';
export function sessionRepo(session: Session, repos: Project[]) {
  return repos
    .filter(
      (repo) =>
        repo.hostId === session.hostId &&
        (session.cwd === repo.path || session.cwd.startsWith(repo.path.replace(/\/$/, '') + '/')),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}
