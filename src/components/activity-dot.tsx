/** What an open session does when the user is not looking at it. */
export type SessionActivityState = 'running' | 'approval';
export interface SessionActivity {
  agent: string;
  id: string;
  projectId?: string;
  cwd: string;
  hostId?: string;
  state: SessionActivityState;
}
export const activityKey = (agent: string, id: string) => agent + ':' + id;
const labels: Record<SessionActivityState, string> = {
  running: 'Agent is working',
  approval: 'Agent is waiting for your approval',
};
/** A small status dot. An approval request has a stronger color than work in progress. */
export function ActivityDot({ state }: { state?: SessionActivityState }) {
  if (!state) return null;
  return (
    <span
      className="activity-dot"
      data-state={state}
      role="img"
      aria-label={labels[state]}
      title={labels[state]}
    />
  );
}
