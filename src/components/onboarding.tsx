import type { API, Snapshot, Agent, Project } from '../types';
import { Progress } from './ui/progress';
import { runtimeProgress, useRuntimeStatus } from '../hooks/use-verdictan-status';

/**
 * Opens a new chat in a code folder with an empty composer. Use it after the first code folder
 * is added: the user lands in the composer, not on a page. Kalkidan sends nothing and writes no
 * draft.
 */
export function startFirstChat(detail: { groupId: string; repoId?: string; agent?: Agent }) {
  window.dispatchEvent(new CustomEvent('kalkidan-new-session', { detail }));
}

/** @deprecated The Get started dialog is gone. The Welcome card is the one first run. */
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

// A bridge with no methods, for callers that do not give `api`. The hook then reads nothing.
const noApi = {} as API;

/**
 * The sidebar footer row while the managed agents service installs: "Setting up agents · 62%"
 * and a bar. Otherwise it renders nothing. There is no "Get started" row or dialog now.
 */
export function GetStartedButton({
  api,
}: {
  /** Without `api`, the row does not know the runtime. */
  api?: API;
  data?: Pick<Snapshot, 'projects' | 'sessions'>;
  onOpen?: () => void;
  className?: string;
}) {
  const runtime = useRuntimeStatus(api || noApi, !!api);
  if (!runtime.busy || runtime.installed) return null;
  const value = runtimeProgress(runtime.status);
  return (
    <div className="onboarding-setup-progress" role="status">
      <span>Setting up agents{value !== undefined ? ` · ${value}%` : ''}</span>
      <Progress value={value} label="Setting up agents" />
    </div>
  );
}

/**
 * @deprecated The Get started dialog is gone: the Welcome card signs in and adds the first
 * project, and the project opens on its composer. Renders nothing.
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
