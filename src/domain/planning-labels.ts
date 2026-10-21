// Plain words for the states of the planning tools. The UI never shows the raw state values.
import type { ProjectBatchResult } from './project-batch';
import type { DocsIssuePlanResult } from './docs-plan';
import type { DispatchPlan } from './parallel-dispatch';
import type { GovernanceEvidence, TaskUsageHistory } from './conversation';

/** The Badge variant for a state. */
export type PlanningTone = 'success' | 'warning' | 'destructive' | 'muted' | 'secondary';
export interface PlanningLabel {
  label: string;
  tone: PlanningTone;
}

const batchStates: Record<ProjectBatchResult['rows'][number]['state'], PlanningLabel> = {
  pending: { label: 'Waiting', tone: 'muted' },
  writing: { label: 'Saving', tone: 'secondary' },
  confirmed: { label: 'Saved', tone: 'success' },
  conflict: { label: 'Changed on GitHub', tone: 'destructive' },
  'unknown-outcome': { label: 'Result not confirmed', tone: 'warning' },
};
/** The result of one field write in a batch. */
export function batchStateLabel(state: string): PlanningLabel {
  return batchStates[state as keyof typeof batchStates] || { label: 'Unknown', tone: 'muted' };
}

const docsPlanStates: Record<DocsIssuePlanResult['rows'][number]['state'], PlanningLabel> = {
  pending: { label: 'Waiting', tone: 'muted' },
  creating: { label: 'Creating', tone: 'secondary' },
  created: { label: 'Draft created', tone: 'secondary' },
  converting: { label: 'Making an issue', tone: 'secondary' },
  linked: { label: 'Adding links', tone: 'secondary' },
  complete: { label: 'Created', tone: 'success' },
};
/** The result of one issue in a docs-to-tasks plan. */
export function docsPlanStateLabel(state: string): PlanningLabel {
  return (
    docsPlanStates[state as keyof typeof docsPlanStates] || { label: 'Unknown', tone: 'muted' }
  );
}

const dispatchStates: Record<DispatchPlan['state'], PlanningLabel> = {
  review: { label: 'Ready to start', tone: 'secondary' },
  running: { label: 'Running', tone: 'secondary' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Done', tone: 'success' },
  canceled: { label: 'Stopped', tone: 'muted' },
};
export function dispatchStateLabel(state: string): PlanningLabel {
  return (
    dispatchStates[state as keyof typeof dispatchStates] || { label: 'Unknown', tone: 'muted' }
  );
}

const dispatchRowStates: Record<DispatchPlan['rows'][number]['state'], PlanningLabel> = {
  queued: { label: 'Waiting', tone: 'muted' },
  preparing: { label: 'Making a branch copy', tone: 'secondary' },
  dispatching: { label: 'Starting the chat', tone: 'secondary' },
  running: { label: 'Running', tone: 'secondary' },
  completed: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'destructive' },
  canceled: { label: 'Stopped', tone: 'muted' },
  uncertain: { label: 'Result not confirmed', tone: 'warning' },
};
export function dispatchRowStateLabel(state: string): PlanningLabel {
  return (
    dispatchRowStates[state as keyof typeof dispatchRowStates] || {
      label: 'Unknown',
      tone: 'muted',
    }
  );
}

const runPhases: Record<TaskUsageHistory['phase'], PlanningLabel> = {
  starting: { label: 'Starting', tone: 'secondary' },
  active: { label: 'Running', tone: 'secondary' },
  'ready-for-review': { label: 'Ready for review', tone: 'success' },
  'launch-failed': { label: 'Could not start', tone: 'destructive' },
  interrupted: { label: 'Interrupted', tone: 'warning' },
};
export function runPhaseLabel(phase: string): PlanningLabel {
  return runPhases[phase as keyof typeof runPhases] || { label: 'Unknown', tone: 'muted' };
}

const evidenceStates: Record<GovernanceEvidence['status'], string> = {
  loading: 'Loading',
  current: 'Up to date',
  reconciling: 'Being checked',
  unavailable: 'Not available',
};
export function evidenceStateLabel(status: string) {
  return evidenceStates[status as keyof typeof evidenceStates] || 'Unknown';
}

/** "1 task", "3 tasks". */
export function plural(count: number, noun: string, many = noun + 's') {
  return `${count} ${count === 1 ? noun : many}`;
}

/** Changes a value such as "pending_review" or "ON_TRACK" to "Pending review", "On track". */
export function words(value: unknown, empty = 'Unknown') {
  if (typeof value !== 'string' || !value.trim()) return empty;
  const text = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return text[0].toUpperCase() + text.slice(1);
}
