// Readiness of tasks for agent work and for release. The checks use a fresh board snapshot.
import type { Session } from './conversation';
import type { GitHubContentSnapshot } from './github-content';
import type { IssueRelations } from './github-relations';
import type { TrackerBoard, TrackerItem } from './tracker';

/** A reason why a task cannot start yet. Each code has one action in the UI. */
export interface ReadinessBlocker {
  code: 'not-open-issue' | 'no-repository' | 'no-description' | 'blocked' | 'linked-chat' | 'error';
  message: string;
  /** For 'linked-chat': the chat that is linked to the task. */
  session?: Pick<Session, 'agent' | 'id' | 'title'>;
}
export interface ReadinessRow {
  id: string;
  title: string;
  repository?: string;
  blockers: ReadinessBlocker[];
  /** Reasons why the task is not ready to release. Empty when it is. */
  release: string[];
  content?: GitHubContentSnapshot;
}

/** Linked chats that are not archived. */
export function linkedChats(sessions: Session[], itemId: string) {
  return sessions.filter(
    (session) => !session.organization?.archived && session.organization?.taskId === itemId,
  );
}

/** Checks one task. `content` and `relations` come from GitHub; an error replaces them. */
export function readinessRow(
  item: TrackerItem | undefined,
  id: string,
  sessions: Session[],
  evidence: { content: GitHubContentSnapshot; relations?: IssueRelations } | { error: string },
): ReadinessRow {
  if (!item)
    return {
      id,
      title: 'Removed task',
      blockers: [{ code: 'error', message: 'The task is not on the board now.' }],
      release: ['The task is not on the board now.'],
    };
  const blockers: ReadinessBlocker[] = [],
    release: string[] = [];
  if ('error' in evidence) {
    blockers.push({ code: 'error', message: evidence.error });
    release.push('Kalkidan could not read the release evidence.');
    return { id, title: item.title, repository: item.repository, blockers, release };
  }
  const { content, relations } = evidence;
  const openBlockers = relations?.blockedBy.some((issue) => issue.state !== 'CLOSED');
  if (item.kind !== 'Issue' || content.state !== 'OPEN')
    blockers.push({ code: 'not-open-issue', message: 'Only open issues can start agent work.' });
  if (!item.repository)
    blockers.push({ code: 'no-repository', message: 'The task has no repository.' });
  if (!item.body.trim())
    blockers.push({
      code: 'no-description',
      message: 'The task has no description or acceptance criteria.',
    });
  if (openBlockers) blockers.push({ code: 'blocked', message: 'Other issues block this task.' });
  const chat = linkedChats(sessions, item.id)[0];
  if (chat)
    blockers.push({
      code: 'linked-chat',
      message: 'A chat is linked to this task. Check that work first.',
      session: { agent: chat.agent, id: chat.id, title: chat.title },
    });
  if (content.kind === 'Issue' && content.state !== 'CLOSED') release.push('The issue is open.');
  if (openBlockers) release.push('Other issues block this task.');
  const prs =
    content.kind === 'PullRequest'
      ? [
          {
            merged: content.state === 'MERGED',
            checks: content.checks,
            checkEvidence: content.checkEvidence,
          },
        ]
      : content.linkedPullRequests || [];
  if (!prs.length) release.push('No pull request closes this task.');
  if (prs.some((pr) => !pr.merged)) release.push('A pull request is not merged.');
  if (
    prs.some(
      (pr) =>
        pr.checks !== 'SUCCESS' ||
        !pr.checkEvidence?.length ||
        pr.checkEvidence.some((check) => check.state !== 'SUCCESS'),
    )
  )
    release.push('Not all checks passed.');
  return { id, title: item.title, repository: item.repository, blockers, release, content };
}

/** Splits ready tasks into waves of at most `limit` tasks. Each task runs in its own copy. */
export function readinessWaves(rows: ReadinessRow[], limit: number) {
  const ready = rows.filter((row) => !row.blockers.length);
  const size = Math.max(1, Math.floor(limit));
  const waves: ReadinessRow[][] = [];
  for (let index = 0; index < ready.length; index += size)
    waves.push(ready.slice(index, index + size));
  return waves;
}

/** Problems that the board shows without a GitHub request, for the Insights page. */
export function localReadiness(board: TrackerBoard, sessions: Session[]) {
  const open = board.items.filter((item) => item.kind === 'Issue');
  const noDescription = open.filter((item) => !item.body.trim());
  const noRepository = board.items.filter((item) => !item.repository);
  const linked = open.filter((item) => linkedChats(sessions, item.id).length > 0);
  const candidates = open.filter(
    (item) => !!item.repository && !!item.body.trim() && !linkedChats(sessions, item.id).length,
  );
  return { issues: open, noDescription, noRepository, linked, candidates };
}
