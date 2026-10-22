import { useEffect, useSyncExternalStore } from 'react';
import type { API } from '../api/contracts';
import type { AgentInstallation } from '../domain/conversation';
import { computersNeedUser } from '../domain/settings-route';
import { useRuntimeStatus } from '../hooks/use-verdictan-status';
import { setAgentInstallations } from '../lib/agent-preference';

// The last agent check of this computer. Settings › Computers and the avatar share it, so the
// dot goes away at once when the user fixes an agent.
let checks: AgentInstallation[] | undefined;
let reading: Promise<void> | undefined;
let readAt = 0;
const listeners = new Set<() => void>();
// The avatar reads again on focus at most once in this time. An agent check runs programs.
const focusReadMs = 60_000;

/** Keeps the result of an agent check of this computer, for the dot on the avatar. */
export function publishAgentChecks(list: AgentInstallation[]) {
  checks = list;
  readAt = Date.now();
  setAgentInstallations(list);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readChecks(api: API) {
  if (reading || typeof api.agentInstallations !== 'function') return;
  reading = Promise.resolve()
    .then(() => api.agentInstallations())
    .then(publishAgentChecks, () => {})
    .finally(() => {
      reading = undefined;
    });
}

/**
 * True when Settings › Computers has something for the user: a coding agent that is missing or
 * too old, or a managed agents install that failed. The avatar and the Computers item of the
 * Settings nav show a dot then.
 */
export function useComputersAttention(api: API) {
  const list = useSyncExternalStore(
    subscribe,
    () => checks,
    () => undefined,
  );
  const runtime = useRuntimeStatus(api);
  useEffect(() => {
    if (!checks) readChecks(api);
    const onFocus = () => {
      if (Date.now() - readAt >= focusReadMs) readChecks(api);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [api]);
  const status = runtime.status;
  const runtimeFailed =
    !!status?.error || (status?.operation?.phase === 'failed' && !status.installed);
  return computersNeedUser(list, runtimeFailed);
}
