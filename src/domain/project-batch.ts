import type { ProjectFieldValue } from './github-mutations';
import type { TrackerItem } from './tracker';
export interface ProjectBatchChange {
  itemId: string;
  fieldId: string;
  before: ProjectFieldValue;
  value: ProjectFieldValue;
}
export interface ProjectBatchRequest {
  id: string;
  changes: ProjectBatchChange[];
}
export interface ProjectBatchResult {
  id: string;
  rows: {
    itemId: string;
    fieldId: string;
    state: 'pending' | 'writing' | 'confirmed' | 'conflict' | 'unknown-outcome';
    message?: string;
  }[];
}
export function projectFieldValue(item: TrackerItem, fieldId: string): ProjectFieldValue {
  const value = item.fieldValues?.find((value) => (value.field as { id?: string })?.id === fieldId);
  if (!value) return null;
  if (typeof value.optionId === 'string') return { singleSelectOptionId: value.optionId };
  if (Array.isArray(value.options))
    return { multiSelectOptionIds: value.options.map((option) => option.id).sort() };
  for (const key of ['text', 'number', 'date', 'iterationId'] as const)
    if (value[key] !== undefined) return { [key]: value[key] } as ProjectFieldValue;
  return null;
}
export function sameProjectValue(a: ProjectFieldValue, b: ProjectFieldValue) {
  const normalize = (value: ProjectFieldValue) =>
    value && 'multiSelectOptionIds' in value
      ? { multiSelectOptionIds: [...value.multiSelectOptionIds].sort() }
      : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
/** What a write changed. Receipts keep IDs and small field values only, never tokens. */
export interface GitHubMutationDetail {
  /** The board item that the write changed. */
  itemId?: string;
  fieldId?: string;
  /** The field value before the write. Present only when Kalkidan read it before writing. */
  before?: ProjectFieldValue;
  /** The field value that the write sent. Null clears the field. */
  value?: ProjectFieldValue;
  /** The ID of the write that this write reverted. */
  revertOf?: string;
}
export interface GitHubMutationReceipt {
  id: string;
  signature: string;
  operation: string;
  state: 'writing' | 'confirmed' | 'rejected' | 'unknown-outcome' | 'reviewed';
  updatedAt: number;
  detail?: GitHubMutationDetail;
  /** The ID of the later write that reverted this write. */
  revertedBy?: string;
}
export type GitHubMutationHistory = Omit<GitHubMutationReceipt, 'signature'>[];
export type GitHubMutationRow = GitHubMutationHistory[number];

const mutationLabels: Record<string, string> = {
  updateProjectV2ItemFieldValue: 'Field changed',
  clearProjectV2ItemFieldValue: 'Field cleared',
  updateStatus: 'Status changed',
  addProjectV2DraftIssue: 'Draft task added',
  addProjectV2ItemById: 'Issue added to the board',
  updateProjectV2DraftIssue: 'Draft task edited',
  convertProjectV2DraftIssueItemToIssue: 'Draft converted to issue',
  updateProjectV2ItemPosition: 'Task moved',
  archiveProjectV2Item: 'Task archived',
  unarchiveProjectV2Item: 'Task restored from archive',
  deleteProjectV2Item: 'Task removed from the board',
  addComment: 'Comment added',
  createProjectV2StatusUpdate: 'Status update created',
  updateProjectV2StatusUpdate: 'Status update edited',
  deleteProjectV2StatusUpdate: 'Status update deleted',
  closeIssue: 'Issue closed',
  reopenIssue: 'Issue reopened',
  closePullRequest: 'Pull request closed',
  reopenPullRequest: 'Pull request reopened',
  addAssigneesToAssignable: 'Assignees added',
  removeAssigneesFromAssignable: 'Assignees removed',
  addLabelsToLabelable: 'Labels added',
  removeLabelsFromLabelable: 'Labels removed',
  addSubIssue: 'Sub-issue added',
  removeSubIssue: 'Sub-issue removed',
  addBlockedBy: 'Blocker added',
  removeBlockedBy: 'Blocker removed',
  addPullRequestReview: 'Review submitted',
  requestReviews: 'Review requested',
  createProjectV2: 'Board created',
  copyProjectV2: 'Board copied',
  deleteProjectV2: 'Board deleted',
  updateProjectV2: 'Board settings changed',
  markProjectV2AsTemplate: 'Template setting changed',
  linkProjectV2ToRepository: 'Repository linked',
  unlinkProjectV2FromRepository: 'Repository unlinked',
  linkProjectV2ToTeam: 'Team linked',
  unlinkProjectV2FromTeam: 'Team unlinked',
  updateProjectV2Collaborators: 'Access changed',
  createProjectV2View: 'View created',
  createProjectV2IssueField: 'Field created',
  createProjectV2Field: 'Field created',
  updateProjectV2Field: 'Field changed',
  deleteProjectV2Field: 'Field deleted',
  'Create configured view': 'View created',
};
/** Plain words for a recorded GitHub write. Unknown operation names become sentence case. */
export function mutationLabel(row: Pick<GitHubMutationRow, 'operation' | 'detail'>) {
  if (row.detail?.revertOf) return 'Change reverted';
  const known = mutationLabels[row.operation];
  if (known) return known;
  const words = row.operation
    .replace(/ProjectV2/g, ' project ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'GitHub change';
}
export const mutationStateLabels: Record<GitHubMutationRow['state'], string> = {
  writing: 'Sending',
  confirmed: 'Confirmed',
  rejected: 'Not sent',
  'unknown-outcome': 'Result not confirmed',
  reviewed: 'Checked on GitHub',
};
/** True when the write is a confirmed field change with a known earlier value. */
export function canRevertMutation(row: GitHubMutationRow) {
  return (
    row.state === 'confirmed' &&
    !row.revertedBy &&
    !!row.detail?.itemId &&
    !!row.detail.fieldId &&
    row.detail.before !== undefined &&
    row.detail.value !== undefined
  );
}
