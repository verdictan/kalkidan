// One pull request body for every Commit and pull request entry point, and the task status
// change after a pull request opens.
import { trackerConnection } from '../domain/tracker';
import { trackerClient } from './tracker-client';
import type { API, ProjectGroup, SessionOrganization, WorkingStatus } from '../types';

export interface PullRequestTask {
  title: string;
  url?: string;
  /** The issue number. Draft items have no number. */
  number?: number;
  /** The issue repository as `owner/repo`. */
  repository?: string;
}

export type SessionPullRequest = NonNullable<SessionOrganization['pullRequest']>;

/** True when GitHub can close the task from a pull request: it is an issue with a number. */
export function closesTask(task: PullRequestTask | undefined) {
  return !!task?.number && !!task.repository && /^[\w.-]+\/[\w.-]+$/.test(task.repository);
}

/**
 * The pull request description. For an issue task, it always has `Closes owner/repo#N`, so
 * GitHub closes the issue when the pull request merges and Readiness finds the evidence.
 */
export function pullRequestBody({
  title,
  summary,
  task,
  sessionTitle,
}: {
  title: string;
  summary?: string;
  task?: PullRequestTask;
  sessionTitle: string;
}) {
  const lines: string[] = [];
  const intro =
    summary?.trim() || (title.trim() && title.trim() !== sessionTitle ? title.trim() : '');
  if (intro) lines.push(intro, '');
  if (task) {
    lines.push(task.url ? `Task: [${task.title}](${task.url})` : `Task: ${task.title}`);
    if (closesTask(task)) lines.push('', `Closes ${task.repository}#${task.number}`);
    lines.push('');
  }
  lines.push(`Made with an agent in the Kalkidan chat “${sessionTitle}”.`);
  return lines.join('\n').trim();
}

/** The pull request number from its GitHub URL. */
export function pullRequestNumber(url: string) {
  const match = url.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return match ? Number(match[1]) : undefined;
}

const stateLabels: Record<NonNullable<SessionPullRequest['state']>, string> = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
};

/**
 * True when a pull request can take work from the checkout: changed files, or commits that the
 * default branch does not have. A branch that is on the remote can also open a pull request.
 */
export function hasBranchWork(status: WorkingStatus) {
  if (status.changed + status.untracked > 0) return true;
  if (status.branch === status.defaultBranch) return false;
  return status.ahead > 0 || status.published;
}

/** "Create pull request…" or "View pull request #12". */
export function pullRequestActionLabel(pr: SessionPullRequest | undefined) {
  if (!pr) return 'Create pull request…';
  return pr.number ? `View pull request #${pr.number}` : 'View pull request';
}

/** For example "PR #12 · Open", or "PR #12 · Draft". */
export function pullRequestLabel(pr: SessionPullRequest) {
  const name = pr.number ? `PR #${pr.number}` : 'Pull request';
  if (pr.state === 'open' && pr.draft) return `${name} · Draft`;
  return pr.state ? `${name} · ${stateLabels[pr.state]}` : name;
}

/** Status option names that mean "in review", in order of preference. */
const reviewNames = ['in review', 'review', 'in code review', 'code review', 'ready for review'];

/**
 * Moves the task to the review option of the board. It uses the Automatic status changes
 * mapping when it has a review option, else the first option with a review name. Returns the
 * option name, or null when the board has no review option or cannot change status.
 */
export async function moveTaskToReview(api: API, group: ProjectGroup | undefined, taskId: string) {
  const connection = trackerConnection(group);
  if (!group || !connection || !taskId) return null;
  const client = trackerClient(api, connection.provider);
  const descriptor = (await client.providers()).find((p) => p.id === connection.provider);
  if (!descriptor?.capabilities.updateStatus) return null;
  const board = await client.board(group.id, true);
  const item = board.items.find((entry) => entry.id === taskId);
  const options = board.statusField?.options || [];
  if (!item || !options.length) return null;
  const mapped = (connection.statusMapping as Record<string, string | undefined> | undefined)
    ?.review;
  const option =
    (mapped && options.find((entry) => entry.id === mapped)) ||
    reviewNames
      .map((name) => options.find((entry) => entry.name.trim().toLowerCase() === name))
      .find(Boolean);
  if (!option) return null;
  if (item.statusId !== option.id) await client.status(group.id, taskId, option.id);
  return option.name;
}

/**
 * The branch name that "Create pull request" suggests on the default branch, for example
 * "kalkidan/add-sign-in-tests" for the chat "Add sign-in tests".
 */
export function suggestedBranch(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // A long title ends at a whole word.
  const short = slug.length > 48 ? slug.slice(0, 48).replace(/-[^-]*$/, '') : slug;
  return `kalkidan/${short && !/^new(-[a-z]+)?-(chat|session)$/.test(short) ? short : 'changes'}`;
}
