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
  labels: { id: string; name: string }[];
  comments: { id: string; body: string; url: string; author?: { login: string } }[];
  milestone?: { id: string; title: string } | null;
  issueType?: { id: string; name: string } | null;
  mergeable?: string;
  reviewDecision?: string;
  reviews?: { id: string; state: string; body: string; author?: { login: string } }[];
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
