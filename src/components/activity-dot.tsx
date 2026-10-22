import { useSyncExternalStore } from 'react';
import {
  chatRowStatus,
  outcomeLabel,
  type ChatOutcome,
  type ChatRowStatus,
} from '../domain/chat-outcome';
import type { Session } from '../domain/conversation';

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
/**
 * The status of a chat row: an activity state, a failed or refused latest run, or 'done' for a
 * finished run not seen yet.
 */
export type ChatStatus = ChatRowStatus;
const statusLabels: Record<ChatStatus, string> = {
  ...activityLabels,
  failed: 'The last run failed.',
  refused: 'Managed agents did not start the last run.',
  done: 'Agent finished. You did not open the chat yet.',
};
/**
 * A small status dot. Approval is amber, a question is blue, work pulses green, a finished run
 * that the user did not see is a hollow green ring, a failed run is red and a refused launch is
 * an amber diamond. `label` replaces the general words, for example with the failure reason.
 */
export function ActivityDot({ state, label }: { state?: ChatStatus; label?: string }) {
  if (!state) return null;
  const text = label || statusLabels[state];
  return (
    <span className="activity-dot" data-state={state} role="img" aria-label={text} title={text} />
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
  /**
   * Outcomes of draft chats, by `activityKey`. A refused draft is not saved, so its outcome
   * stays in memory while the app runs.
   */
  drafts: Record<string, ChatOutcome>;
}
// One store for the shell and the pages that show "Needs you". The shell publishes the
// activity of the open chats. Pages read it without props.
let state: ActivityState = { activity: [], finished: [], drafts: {} };
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
/** Removes the "finished" mark when the user opens the chat. A failed run keeps its mark. */
export function markSeen(agent: string, id: string) {
  if (!state.finished.some((item) => item.agent === agent && item.id === id)) return;
  emit({
    ...state,
    finished: state.finished.filter((item) => item.agent !== agent || item.id !== id),
  });
}
/** Keeps the outcome of a draft chat in memory. Undefined removes it. */
export function markDraftOutcome(agent: string, id: string, outcome: ChatOutcome | undefined) {
  const key = activityKey(agent, id);
  if (!outcome && !state.drafts[key]) return;
  const drafts = { ...state.drafts };
  if (outcome) drafts[key] = outcome;
  else delete drafts[key];
  emit({ ...state, drafts });
}
/** The current store, without a subscription. */
export const activitySnapshot = () => state;
/** The activity of the open chats and the finished runs not seen yet. */
export function useActivityState() {
  return useSyncExternalStore(subscribe, () => state);
}
/** The status and its words for one chat row. */
export interface ChatStatusInfo {
  state: ChatStatus;
  label?: string;
}
/** The status of a chat row from its live state, its stored outcome and the store. */
export function chatStatusInfo(
  session: Pick<Session, 'agent' | 'id' | 'outcome' | 'liveRunId'>,
  live: SessionActivityState | undefined,
  store: Pick<ActivityState, 'finished' | 'drafts'>,
): ChatStatusInfo | undefined {
  // A run that continues on an SSH host is work in progress, also when its chat is not open.
  if (!live && session.liveRunId) return { state: 'running', label: 'Running on the SSH host.' };
  const outcome = session.outcome || store.drafts[activityKey(session.agent, session.id)];
  const status = chatRowStatus({
    live,
    outcome,
    unseen: store.finished.some((item) => item.agent === session.agent && item.id === session.id),
  });
  if (!status) return undefined;
  return status === 'failed' || status === 'refused'
    ? { state: status, label: outcomeLabel(outcome!) }
    : { state: status };
}
/** A function that gives the status of a chat row. It reads the store. */
export function useChatStatus() {
  const store = useActivityState();
  return (
    session: Pick<Session, 'agent' | 'id' | 'outcome' | 'liveRunId'>,
    live?: SessionActivityState,
  ) => chatStatusInfo(session, live, store);
}
/** The status dot of one chat row. */
export function ChatStatusDot({
  session,
  live,
}: {
  session: Pick<Session, 'agent' | 'id' | 'outcome' | 'liveRunId'>;
  live?: SessionActivityState;
}) {
  const info = chatStatusInfo(session, live, useActivityState());
  return <ActivityDot state={info?.state} label={info?.label} />;
}
