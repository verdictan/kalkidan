export interface GitHubContentSnapshot {
  checkEvidence?: GitHubCheckEvidence[];
  linkedPullRequests?: {
    id: string;
    title: string;
    url: string;
    state: string;
    merged: boolean;
    headRefOid: string;
    reviewDecision?: string;
    checks?: string;
    checkEvidence: GitHubCheckEvidence[];
  }[];
  id: string;
  kind: 'Issue' | 'PullRequest';
  title: string;
  body: string;
  state: string;
  revision: string;
  permissions: { edit: boolean; close: boolean; reopen: boolean; assign: boolean; label: boolean };
  milestones?: { id: string; title: string }[];
  issueTypes?: { id: string; name: string }[];
  headOid?: string;
  checks?: string;
  canSetMilestone?: boolean;
  canSetType?: boolean;
  viewerDidAuthor?: boolean;
  assignees: { id: string; login: string }[];
  /** `color` is a hex color without "#", as GitHub sends it. */
  labels: { id: string; name: string; color?: string }[];
  comments: {
    id: string;
    body: string;
    url: string;
    /** ISO 8601 time. */
    createdAt?: string;
    author?: { login: string };
  }[];
  milestone?: { id: string; title: string } | null;
  issueType?: { id: string; name: string } | null;
  mergeable?: string;
  reviewDecision?: string;
  reviews?: {
    id: string;
    state: string;
    body: string;
    /** ISO 8601 time. Null for a pending review. */
    submittedAt?: string | null;
    author?: { login: string };
  }[];
}
export interface GitHubCheckEvidence {
  name: string;
  state: string;
  url?: string;
  kind: 'status' | 'check';
}
export type GitHubContentAction =
  | { kind: 'milestone' | 'issue-type'; id: string | null }
  | { kind: 'request-review'; login: string }
  | {
      kind: 'review';
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      body: string;
      headOid: string;
    }
  | { kind: 'edit'; title: string; body: string }
  | { kind: 'comment'; body: string }
  | { kind: 'close' | 'reopen' }
  | { kind: 'assign' | 'unassign'; login: string }
  | { kind: 'label' | 'unlabel'; name: string };
export interface GitHubContentAPI {
  trackerContent(group: string, item: string): Promise<GitHubContentSnapshot>;
  trackerContentChange(
    group: string,
    item: string,
    revision: string,
    action: GitHubContentAction,
  ): Promise<GitHubContentSnapshot>;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * True when `body` has a GitHub closing keyword for the issue, for example "Closes owner/repo#12",
 * "Fixes #12" or "Resolves https://github.com/owner/repo/issues/12".
 */
export function closesIssue(
  body: string,
  issue: { owner?: string; repository?: string; number?: number },
) {
  if (typeof body !== 'string' || !Number.isSafeInteger(issue.number)) return false;
  const number = String(issue.number);
  const targets = ['#' + number];
  if (issue.owner && issue.repository) {
    const name = escapeRegExp(issue.owner + '/' + issue.repository);
    targets.push(name + '#' + number, 'https://github\\.com/' + name + '/issues/' + number);
  }
  return new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+(?:${targets.join('|')})(?![\\w/])`,
    'i',
  ).test(body);
}
