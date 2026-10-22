import { useCallback, useEffect, useRef, useState } from 'react';
import type { API } from '../api/contracts';
import type { FirstRunState, VerdictanStatus } from '../domain/verdictan';
import type { ComponentUpdateStatus } from '../domain/updates';
import { accountChanging, runtimeBusy } from '../lib/verdictan-labels';

/** The account and the setup changed. Onboarding and Settings read the state again. */
const managedAgentsChangedEvent = 'kalkidan-managed-agents-changed';

// Read again often only while something runs. Otherwise read on focus and on a broadcast.
const accountPollMs = 1000;
const runtimePollMs = 1500;
const changeRetryMs = 1000;

/**
 * The Verdictan account state. It reads the state when the window gets focus, when the desktop
 * broadcasts a change, and each second while a sign-in or a check runs. Undefined while unknown,
 * and always undefined in builds without managed agents.
 */
export function useVerdictanStatus(api: API, active = true) {
  const supported = typeof api.verdictanStatus === 'function';
  const [status, setStatus] = useState<VerdictanStatus>();
  const generation = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const read = useCallback(
    function readStatus() {
      if (!supported) return;
      const id = generation.current;
      clearTimeout(retry.current);
      void Promise.resolve()
        .then(() => api.verdictanStatus())
        .then(
          (next) => {
            if (generation.current === id) setStatus(next);
          },
          (failure) => {
            // The desktop changes the account or the region. Read again a little later.
            if (generation.current === id && accountChanging(failure))
              retry.current = setTimeout(readStatus, changeRetryMs);
          },
        );
    },
    [api, supported],
  );
  useEffect(() => {
    if (!active || !supported) return;
    generation.current++;
    read();
    window.addEventListener('focus', read);
    window.addEventListener(managedAgentsChangedEvent, read);
    const unsubscribe = api.onVerdictanChanged?.(read);
    return () => {
      generation.current++;
      clearTimeout(retry.current);
      window.removeEventListener('focus', read);
      window.removeEventListener(managedAgentsChangedEvent, read);
      unsubscribe?.();
    };
  }, [api, active, supported, read]);
  const waiting = status?.phase === 'authorizing' || status?.phase === 'checking';
  useEffect(() => {
    if (!active || !waiting) return;
    const timer = setInterval(read, accountPollMs);
    return () => clearInterval(timer);
  }, [active, waiting, read]);
  return { status, setStatus, read, supported };
}

/**
 * The install state of the managed agents runtime on this computer. This is the only source
 * for "is the runtime ready". The account phase is not. It reads again while an install runs.
 */
export function useRuntimeStatus(api: API, active = true) {
  const supported = typeof api.runtimeUpdateStatus === 'function';
  const [status, setStatus] = useState<ComponentUpdateStatus>();
  const live = useRef(true);
  const read = useCallback(async () => {
    if (!supported) return undefined;
    try {
      const next = await api.runtimeUpdateStatus('local');
      if (live.current) setStatus(next);
      return next;
    } catch {
      return undefined;
    }
  }, [api, supported]);
  useEffect(() => {
    live.current = true;
    if (!active || !supported) return;
    void read();
    const refresh = () => void read();
    window.addEventListener('focus', refresh);
    const unsubscribe = api.onVerdictanChanged?.(refresh);
    return () => {
      live.current = false;
      window.removeEventListener('focus', refresh);
      unsubscribe?.();
    };
  }, [api, active, supported, read]);
  const busy = runtimeBusy(status) || status?.discovery === 'checking';
  useEffect(() => {
    if (!active || !busy) return;
    const timer = setInterval(() => void read(), runtimePollMs);
    return () => clearInterval(timer);
  }, [active, busy, read]);
  return { status, read, supported, busy: runtimeBusy(status), installed: !!status?.installed };
}

/**
 * How far the runtime install is, from 0 to 100. The download is most of the work, so it uses
 * the received bytes. The other phases get fixed steps.
 */
export function runtimeProgress(status: ComponentUpdateStatus | undefined) {
  const operation = status?.operation;
  if (!operation) return status?.installing ? 2 : undefined;
  switch (operation.phase) {
    case 'requested':
      return 2;
    case 'downloading':
      return operation.totalBytes > 0
        ? Math.round(5 + (80 * operation.receivedBytes) / operation.totalBytes)
        : 5;
    case 'verifying':
      return 88;
    case 'staged':
    case 'waiting-for-idle':
    case 'activating':
      return 92;
    case 'validating':
      return 96;
    case 'completed':
      return 100;
    default:
      return undefined;
  }
}

/** The first-run state from the main process. Undefined while unknown or not supported. */
export function useFirstRunState(api: API) {
  const [state, setState] = useState<FirstRunState>();
  const supported = typeof api.firstRunState === 'function';
  const read = useCallback(() => {
    if (!supported) return;
    void Promise.resolve()
      .then(() => api.firstRunState())
      .then(setState, () => setState({ welcomeDone: true, everSignedIn: false }));
  }, [api, supported]);
  useEffect(() => {
    read();
    const unsubscribe = api.onVerdictanChanged?.(read);
    return () => unsubscribe?.();
  }, [api, read]);
  return { state, read, supported };
}
