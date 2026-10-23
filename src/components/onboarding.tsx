import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { API, Snapshot, Agent, Project } from '../types';
import type { DesktopAPI, GatewayRuntimeState } from '../domain/desktop';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

/**
 * Opens a new chat in a code folder with an empty composer. Use it after the first code folder
 * is added: the user lands in the composer, not on a page. Kalkidan sends nothing and writes no
 * draft.
 */
export function startFirstChat(detail: { groupId: string; repoId?: string; agent?: Agent }) {
  window.dispatchEvent(new CustomEvent('kalkidan-new-session', { detail }));
}

/** @deprecated The Get started dialog is gone. The tools check is the one first run. */
export function openGetStarted() {}

const storageKey = 'kalkidan:onboarding:v1';
/** @deprecated The Get started dialog is gone. */
export function onboardingDismissed() {
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}
/** @deprecated The Get started dialog is gone. */
export function dismissOnboarding() {
  try {
    localStorage.setItem(storageKey, 'dismissed');
  } catch {
    /* Nothing depends on it. */
  }
}

/**
 * The three first-run steps: sign in, a code folder, then a first chat. `signedIn` is true when
 * the build has no managed agents, for example in the browser preview.
 */
export function onboardingProgress(data: Pick<Snapshot, 'projects' | 'sessions'>, signedIn = true) {
  const done =
    (signedIn ? 1 : 0) + (data.projects.length > 0 ? 1 : 0) + (data.sessions.length > 0 ? 1 : 0);
  return { done, total: 3, complete: done === 3 };
}

/** @deprecated The Get started dialog is gone. Always false. */
export function useSetupIncomplete() {
  return false;
}

/** @deprecated The account menu has no "Get started" item now. Renders nothing. */
export function GetStartedMenuItem() {
  return null;
}

/** The managed gateway runtime, when the desktop reports it. */
function gateway(api: API) {
  return api as API & DesktopAPI;
}

/**
 * The sidebar footer row for the managed gateway runtime. The runtime installs and repairs
 * itself after the sign-in; that is never a task for the user, so the row shows nothing while
 * it works. It shows only a failure that the user can act on: the message and "Try again".
 */
export function GetStartedButton({
  api,
  className,
}: {
  /** Without `api`, the row shows nothing. */
  api?: API;
  data?: Pick<Snapshot, 'projects' | 'sessions'>;
  onOpen?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<GatewayRuntimeState>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!api || typeof gateway(api).gatewayRuntime !== 'function') return;
    let live = true;
    const read = () =>
      void Promise.resolve()
        .then(() => gateway(api).gatewayRuntime!())
        .then((next) => live && setState(next))
        .catch(() => undefined);
    read();
    const stop = api.onVerdictanChanged?.(read);
    window.addEventListener('focus', read);
    return () => {
      live = false;
      stop?.();
      window.removeEventListener('focus', read);
    };
  }, [api]);
  if (!api || state?.state !== 'failed') return null;
  async function retry() {
    if (!api || typeof gateway(api).gatewayRuntimeRetry !== 'function') return;
    setBusy(true);
    try {
      setState(await gateway(api).gatewayRuntimeRetry!());
    } catch {
      /* The row stays. The user can try again. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={cn('st-runtime-failed', className)} role="alert">
      <CircleAlert className="st-tool-warn" aria-hidden="true" />
      <span className="min-w-0 flex-1">{state.message || 'Agents could not start.'}</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void retry()}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </div>
  );
}

/**
 * @deprecated The Get started dialog is gone: the tools check shows when a tool is missing, and
 * the sign-in comes at the first send. Renders nothing.
 */
export function Onboarding(_props: {
  api: API;
  data: Snapshot;
  open: boolean;
  preview: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onSettings?: () => void;
  onStart: (agent: Agent, repo: Project, prompt: string) => void;
  onConnectBoard?: (groupId: string) => void;
}) {
  return null;
}
