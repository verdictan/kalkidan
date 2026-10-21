// Words for the raw GitHub values that the API returns. The UI never shows an API value as it
// is: it shows the word from these maps, or a sentence-case form of the value.

/** Changes a value such as "CHANGES_REQUESTED" to "Changes requested". */
export function sentenceCase(value: string) {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

function lookup(map: Record<string, string>, value: string | null | undefined, empty = '') {
  if (!value) return empty;
  return map[value] ?? map[value.toUpperCase()] ?? sentenceCase(value);
}

export type LabelTone = 'success' | 'warning' | 'destructive' | 'muted' | 'default';

const fieldTypes: Record<string, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  SINGLE_SELECT: 'Single select',
  MULTI_SELECT: 'Multiple select',
  ITERATION: 'Iteration',
  TITLE: 'Title',
  ASSIGNEES: 'Assignees',
  LABELS: 'Labels',
  LINKED_PULL_REQUESTS: 'Linked pull requests',
  MILESTONE: 'Milestone',
  REPOSITORY: 'Repository',
  REVIEWERS: 'Reviewers',
  PARENT_ISSUE: 'Parent issue',
  SUB_ISSUES_PROGRESS: 'Sub-issue progress',
  TRACKED_BY: 'Tracked by',
  TRACKS: 'Tracks',
  ISSUE_TYPE: 'Issue type',
};
/** The field types that a user can create on a GitHub project. */
export const editableFieldTypes = [
  'TEXT',
  'NUMBER',
  'DATE',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'ITERATION',
] as const;
export const fieldTypeLabel = (value?: string | null) => lookup(fieldTypes, value, 'Unknown');

/** The colors of single and multiple select options, with a swatch for each one. */
export const optionColors = [
  { value: 'GRAY', label: 'Gray', swatch: '#8b949e' },
  { value: 'BLUE', label: 'Blue', swatch: '#4493f8' },
  { value: 'GREEN', label: 'Green', swatch: '#3fb950' },
  { value: 'YELLOW', label: 'Yellow', swatch: '#d29922' },
  { value: 'ORANGE', label: 'Orange', swatch: '#db6d28' },
  { value: 'RED', label: 'Red', swatch: '#f85149' },
  { value: 'PINK', label: 'Pink', swatch: '#db61a2' },
  { value: 'PURPLE', label: 'Purple', swatch: '#a371f7' },
] as const;
export function optionColor(value?: string | null) {
  return optionColors.find((color) => color.value === value?.toUpperCase()) ?? optionColors[0];
}

const itemStates: Record<string, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  MERGED: 'Merged',
  DRAFT: 'Draft',
};
export const itemStateLabel = (value?: string | null) => lookup(itemStates, value, 'Unknown');
export function itemStateTone(value?: string | null): LabelTone {
  const state = value?.toUpperCase();
  return state === 'OPEN' ? 'success' : state === 'MERGED' ? 'default' : 'muted';
}

const itemKinds: Record<string, string> = {
  Issue: 'Issue',
  PullRequest: 'Pull request',
  DraftIssue: 'Draft issue',
  REDACTED: 'No access',
};
export const itemKindLabel = (value?: string | null) => lookup(itemKinds, value, 'Item');

/** Pull request state, with "Merged" when the pull request is merged. */
export function pullRequestStateLabel(state?: string | null, merged?: boolean) {
  return merged ? 'Merged' : itemStateLabel(state);
}

const mergeable: Record<string, string> = {
  MERGEABLE: 'Can merge',
  CONFLICTING: 'Has merge conflicts',
  UNKNOWN: 'Merge check pending',
};
export const mergeableLabel = (value?: string | null) => lookup(mergeable, value);

const reviewDecisions: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
};
export const reviewDecisionLabel = (value?: string | null) =>
  lookup(reviewDecisions, value, 'No review yet');
export function reviewDecisionTone(value?: string | null): LabelTone {
  return value === 'APPROVED'
    ? 'success'
    : value === 'CHANGES_REQUESTED'
      ? 'destructive'
      : value === 'REVIEW_REQUIRED'
        ? 'warning'
        : 'muted';
}

const reviewStates: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Requested changes',
  COMMENTED: 'Commented',
  DISMISSED: 'Dismissed',
  PENDING: 'Pending',
};
export const reviewStateLabel = (value?: string | null) => lookup(reviewStates, value);

const checkStates: Record<string, string> = {
  SUCCESS: 'Passed',
  FAILURE: 'Failed',
  ERROR: 'Error',
  PENDING: 'Pending',
  EXPECTED: 'Expected',
  NEUTRAL: 'Neutral',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
  TIMED_OUT: 'Timed out',
  ACTION_REQUIRED: 'Action required',
  STALE: 'Stale',
  STARTUP_FAILURE: 'Failed to start',
  IN_PROGRESS: 'Running',
  QUEUED: 'Queued',
  WAITING: 'Waiting',
  REQUESTED: 'Requested',
  COMPLETED: 'Completed',
};
export const checkStateLabel = (value?: string | null) => lookup(checkStates, value, 'No checks');
export function checkStateTone(value?: string | null): LabelTone {
  const state = value?.toUpperCase() || '';
  if (['SUCCESS', 'COMPLETED'].includes(state)) return 'success';
  if (['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(state))
    return 'destructive';
  if (['PENDING', 'EXPECTED', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED'].includes(state))
    return 'warning';
  return 'muted';
}
const checkKinds: Record<string, string> = { status: 'Status', check: 'Check run' };
export const checkKindLabel = (value?: string | null) => lookup(checkKinds, value);

const statusUpdates: Record<string, string> = {
  INACTIVE: 'Inactive',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  COMPLETE: 'Complete',
};
export const statusUpdateValues = Object.keys(statusUpdates);
export const statusUpdateLabel = (value?: string | null) => lookup(statusUpdates, value);

const viewLayouts: Record<string, string> = {
  TABLE_LAYOUT: 'Table',
  BOARD_LAYOUT: 'Board',
  ROADMAP_LAYOUT: 'Roadmap',
};
export const viewLayoutLabel = (value?: string | null) => lookup(viewLayouts, value);

const roles: Record<string, string> = {
  READER: 'Read',
  WRITER: 'Write',
  ADMIN: 'Admin',
  NONE: 'No access',
};
export const roleLabel = (value?: string | null) => lookup(roles, value);

const mutations: Record<string, string> = {
  addAssigneesToAssignable: 'Add an assignee',
  addBlockedBy: 'Add a blocker',
  addComment: 'Post a comment',
  addLabelsToLabelable: 'Add a label',
  addProjectV2DraftIssue: 'Create a draft task',
  addProjectV2ItemById: 'Add a task to the board',
  addPullRequestReview: 'Submit a review',
  addSubIssue: 'Add a child issue',
  archiveProjectV2Item: 'Archive a task',
  clearProjectV2ItemFieldValue: 'Clear a field value',
  closeIssue: 'Close an issue',
  closePullRequest: 'Close a pull request',
  convertProjectV2DraftIssueItemToIssue: 'Convert a draft to an issue',
  copyProjectV2: 'Copy the project',
  createConfiguredProjectView: 'Create a view',
  createIssue: 'Create an issue',
  createProjectV2: 'Create a project',
  createProjectV2Field: 'Create a field',
  createProjectV2IssueField: 'Add an issue field',
  createProjectV2StatusUpdate: 'Post a status update',
  createProjectV2View: 'Create a view',
  deleteProjectV2: 'Delete the project',
  deleteProjectV2Field: 'Delete a field',
  deleteProjectV2Item: 'Remove a task from the board',
  deleteProjectV2StatusUpdate: 'Delete a status update',
  deleteProjectV2View: 'Delete a view',
  deleteProjectV2Workflow: 'Delete a workflow',
  linkProjectV2ToRepository: 'Link a repository',
  linkProjectV2ToTeam: 'Link a team',
  markProjectV2AsTemplate: 'Make the project a template',
  removeAssigneesFromAssignable: 'Remove an assignee',
  removeBlockedBy: 'Remove a blocker',
  removeLabelsFromLabelable: 'Remove a label',
  removeSubIssue: 'Remove a child issue',
  reopenIssue: 'Reopen an issue',
  reopenPullRequest: 'Reopen a pull request',
  reprioritizeSubIssue: 'Move a child issue',
  requestReviews: 'Request a review',
  unarchiveProjectV2Item: 'Restore a task',
  unlinkProjectV2FromRepository: 'Unlink a repository',
  unlinkProjectV2FromTeam: 'Unlink a team',
  unmarkProjectV2AsTemplate: 'Stop using the project as a template',
  updateIssue: 'Edit an issue',
  updateIssueIssueType: 'Change the issue type',
  updateProjectV2: 'Change project settings',
  updateProjectV2Collaborators: 'Change project access',
  updateProjectV2DraftIssue: 'Edit a draft task',
  updateProjectV2Field: 'Change a field',
  updateProjectV2ItemFieldValue: 'Change a field value',
  updateProjectV2ItemPosition: 'Move a task',
  updateProjectV2StatusUpdate: 'Edit a status update',
  updateProjectV2View: 'Change a view',
  updatePullRequest: 'Edit a pull request',
};
/** A GitHub GraphQL mutation name, such as "addComment", as words: "Post a comment". */
export const mutationLabel = (value?: string | null) =>
  value ? (mutations[value] ?? sentenceCase(value)) : 'Unknown change';

/** A commit SHA as its first 7 characters. */
export const shortSha = (value?: string | null) => (value ? value.slice(0, 7) : '');

/** A time as "just now", "5 min ago", "3 h ago", "2 d ago" or a date. */
export function relativeTime(value: string | number | Date | undefined | null, now = Date.now()) {
  if (value === undefined || value === null || value === '') return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(time).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: new Date(time).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

/** The current time in milliseconds, for "Updated just now" notes after a write. */
export const timestamp = () => Date.now();
