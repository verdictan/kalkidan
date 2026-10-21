import { useSyncExternalStore } from 'react';

/** What an open chat does when the user is not looking at it. */
export type SessionActivityState = 'running' | 'approval' | 'question';
export interface SessionActivity {
  agent: string;
  id: string;
  projectId?: string;
  cwd: string;
  hostId?: string;
  state: SessionActivityState;
}
export const activityKey = (agent: string, id: string) => agent + ':' + id;
export const activityLabels: Record<SessionActivityState, string> = {
  running: 'Agent is working',
  approval: 'Waiting for your approval',
  question: 'Waiting for your answer',
};
/** True for the states that wait for the user: an approval or a question. */
export const waitsForUser = (state?: SessionActivityState) =>
  state === 'approval' || state === 'question';
/** The strongest state of a group: approval, then question, then work in progress. */
export function strongestActivity(states: (SessionActivityState | undefined)[]) {
  if (states.includes('approval')) return 'approval';
  if (states.includes('question')) return 'question';
  return states.find(Boolean);
}
/** The status of a chat row: an activity state, or 'done' for a finished run not seen yet. */
export type ChatStatus = SessionActivityState | 'done';
const statusLabels: Record<ChatStatus, string> = {
  ...activityLabels,
  done: 'Agent finished. You did not open the chat yet.',
};
/**
 * A small status dot. Approval is amber, a question is blue, work pulses green, and a finished
 * run that the user did not see is a hollow green ring.
 */
export function ActivityDot({ state }: { state?: ChatStatus }) {
  if (!state) return null;
  return (
    <span
      className="activity-dot"
      data-state={state}
      role="img"
      aria-label={statusLabels[state]}
      title={statusLabels[state]}
    />
  );
}

/** A finished run that the user did not open yet. */
export interface FinishedRun {
  agent: string;
  id: string;
  at: string;
}
interface ActivityState {
  activity: SessionActivity[];
  finished: FinishedRun[];
}
// One store for the shell and the pages that show "Needs you". The shell publishes the
// activity of the open chats. Pages read it without props.
let state: ActivityState = { activity: [], finished: [] };
const listeners = new Set<() => void>();
function emit(next: ActivityState) {
  state = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** The shell calls this when the activity of the open chats changes. */
export function publishActivity(activity: SessionActivity[]) {
  emit({ ...state, activity });
}
/** Records a run that finished while the user looked at a different page. */
export function markFinished(agent: string, id: string) {
  emit({
    ...state,
    finished: [
      { agent, id, at: new Date().toISOString() },
      ...state.finished.filter((item) => item.agent !== agent || item.id !== id),
    ].slice(0, 20),
  });
}
/** Removes the "finished" mark when the user opens the chat. */
export function markSeen(agent: string, id: string) {
  if (!state.finished.some((item) => item.agent === agent && item.id === id)) return;
  emit({
    ...state,
    finished: state.finished.filter((item) => item.agent !== agent || item.id !== id),
  });
}
/** The activity of the open chats and the finished runs not seen yet. */
export function useActivityState() {
  return useSyncExternalStore(subscribe, () => state);
}
