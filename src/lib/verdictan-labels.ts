// Plain words for managed-agent and update states. The UI never shows the raw API values.
import {
  computerAgentIssue,
  localComputer,
  managedErrorInfo,
  managedErrors,
  selectionIssue,
  serviceName,
} from '../domain/verdictan';
import type { VerdictanSetup, VerdictanStatus } from '../domain/verdictan';
import type {
  ComponentUpdateStatus,
  HelperUpdateStatus,
  RuntimeTransferProgress,
  UpdatePhase,
} from '../domain/updates';

/** The Badge variant for a status. */
export type StatusTone = 'success' | 'warning' | 'muted' | 'destructive' | 'secondary';

export interface StatusLabel {
  label: string;
  tone: StatusTone;
}

/** The account state in Settings › Account. */
export const accountPhaseLabels: Record<VerdictanStatus['phase'], StatusLabel> = {
  missing: { label: 'Runtime not installed', tone: 'muted' },
  checking: { label: 'Checking…', tone: 'secondary' },
  'signed-out': { label: 'Signed out', tone: 'muted' },
  authorizing: { label: 'Signing in…', tone: 'secondary' },
  authenticated: { label: 'Signed in', tone: 'success' },
  expired: { label: 'Session expired', tone: 'warning' },
  error: { label: 'Check failed', tone: 'destructive' },
};

/**
 * True for the error that the desktop sends while it changes the account or the region. The
 * change is expected and short. Read the status again after it, and do not show an error.
 */
export function accountChanging(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Account is changing/.test(message);
}

export function accountPhaseLabel(phase: VerdictanStatus['phase'] | undefined): StatusLabel {
  return phase ? accountPhaseLabels[phase] : { label: 'Checking…', tone: 'secondary' };
}

/** The phase of a runtime install or update. */
export const updatePhaseLabels: Record<UpdatePhase, string> = {
  requested: 'Starting',
  downloading: 'Downloading',
  verifying: 'Verifying the download',
  staged: 'Ready to install',
  'waiting-for-idle': 'Waiting for active work to stop',
  activating: 'Installing',
  validating: 'Checking the install',
  completed: 'Installed',
  canceled: 'Canceled',
  failed: 'Failed',
  interrupted: 'Interrupted',
  'unknown-outcome': 'Result not known',
  'rolling-back': 'Restoring the previous version',
  'rolled-back': 'Previous version restored',
  'rollback-failed': 'Could not restore the previous version',
};

export function updatePhaseLabel(phase: UpdatePhase | string) {
  return updatePhaseLabels[phase as UpdatePhase] || 'Unknown state';
}

/** The verb of a running install step, for the progress line. */
const progressVerbs: Partial<Record<UpdatePhase, string>> = {
  requested: 'Starting the install of',
  downloading: 'Downloading',
  verifying: 'Verifying',
  staged: 'Preparing',
  'waiting-for-idle': 'Waiting to install',
  activating: 'Installing',
  validating: 'Checking',
  'rolling-back': 'Restoring the version before',
};

/**
 * The progress line of a runtime install, for example "Verifying version 0.6.9…" or
 * "Downloading version 0.6.9 · 42%".
 */
export function runtimeProgressLabel(
  phase: UpdatePhase | string,
  version: string,
  percent?: number,
) {
  const verb = progressVerbs[phase as UpdatePhase] || updatePhaseLabel(phase);
  const target = `${verb} version ${displayVersion(version)}`;
  return percent === undefined ? `${target}…` : `${target} · ${Math.round(percent)}%`;
}

/** The help line of a copy of the runtime to an SSH host, with its progress. */
export function transferProgressLabel(progress: RuntimeTransferProgress) {
  const percent = transferPercent(progress);
  const step = {
    downloading: 'Downloading managed agents on this computer',
    verifying: 'Checking the signature on this computer',
    copying: 'Copying managed agents to the host',
    installing: 'The host checks and installs managed agents',
  }[progress.phase];
  return percent === undefined ? `${step}…` : `${step} · ${Math.round(percent)}%`;
}

/** The percent of a copy step that moves bytes, or undefined. */
export function transferPercent(progress: RuntimeTransferProgress) {
  if (!['downloading', 'copying'].includes(progress.phase) || progress.totalBytes <= 0)
    return undefined;
  return Math.min(100, (progress.bytes / progress.totalBytes) * 100);
}

/** Phases in which an install or update is still running. */
export const activeUpdatePhases: readonly UpdatePhase[] = [
  'requested',
  'downloading',
  'verifying',
  'activating',
  'validating',
  'rolling-back',
];

/** True while a runtime install or update runs, or waits for active work to stop. */
export function updateRunning(status: ComponentUpdateStatus | undefined) {
  const phase = status?.operation?.phase;
  return !!phase && (activeUpdatePhases.includes(phase) || phase === 'waiting-for-idle');
}

/**
 * True while an install runs on the host. This includes the start of an install, before the
 * host writes the new operation to its journal.
 */
export function runtimeBusy(status: ComponentUpdateStatus | undefined) {
  return updateRunning(status) || !!status?.installing;
}

/** True when the latest runtime release is not installed and Kalkidan can install it now. */
export function runtimeInstallable(status: ComponentUpdateStatus | undefined) {
  if (!status?.latest) return false;
  if (typeof status.canInstall === 'boolean') return status.canInstall;
  return status.installed?.sha256 !== status.latest.sha256;
}

/** True when the latest release is not installed, also when it cannot be installed now. */
export function runtimeOutdated(status: ComponentUpdateStatus | undefined) {
  return !!status?.latest && status.installed?.sha256 !== status.latest.sha256;
}

/** The runtime state of a computer in Settings › Computers. */
export function runtimeStatusLabel(status: ComponentUpdateStatus | undefined): StatusLabel {
  if (!status || status.discovery === 'checking') return { label: 'Checking…', tone: 'secondary' };
  if (updateRunning(status))
    return { label: updatePhaseLabel(status.operation!.phase), tone: 'secondary' };
  if (status.installing) return { label: 'Installing…', tone: 'secondary' };
  if (status.discovery === 'failed' && !status.installed)
    return { label: 'Check failed', tone: 'destructive' };
  if (!status.installed)
    return status.latest
      ? { label: 'Not installed', tone: 'warning' }
      : { label: 'Not installed', tone: 'muted' };
  if (runtimeOutdated(status)) return { label: 'Update ready', tone: 'warning' };
  if (status.discovery === 'failed') return { label: 'Check failed', tone: 'destructive' };
  return { label: 'Ready', tone: 'success' };
}

/** The SSH helper state in Settings › Computers. */
export function helperStatusLabel(helper: HelperUpdateStatus): StatusLabel {
  if (!helper.connected && helper.discovery !== 'current')
    return { label: 'Disconnected', tone: 'muted' };
  switch (helper.discovery) {
    case 'current':
      return { label: 'Up to date', tone: 'success' };
    case 'available':
      return { label: 'Update available', tone: 'warning' };
    case 'waiting-for-idle':
      return { label: 'Waiting for active work to stop', tone: 'secondary' };
    default:
      return { label: 'Not checked', tone: 'muted' };
  }
}

/** A version without the build suffix, for example "1.5.0" for "1.5.0-build.17925.4a1a9a9". */
export function displayVersion(version: string) {
  return version.replace(/[-+]build[.-].*$/i, '');
}

/** A 7-character build digest for display. Do not use it for service IDs. */
export function shortId(value: string) {
  return value.replace(/^(cfgv?|pc|team)_/, '').slice(0, 7);
}

const providerNames: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** The name of a model provider, for example "OpenAI" for "openai". */
export function providerName(provider: string) {
  return providerNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Models that the organization allows, when the runtime sends them. */
export function allowedModels(setup: VerdictanSetup | undefined, agent: 'codex' | 'claude') {
  const value = (setup as (VerdictanSetup & { allowedModels?: unknown }) | undefined)
    ?.allowedModels;
  if (Array.isArray(value)) return value.filter((item): item is string => !!text(item));
  if (value && typeof value === 'object') {
    const list = (value as Record<string, unknown>)[agent];
    if (Array.isArray(list)) return list.filter((item): item is string => !!text(item));
  }
  return undefined;
}

/**
 * The organization, user name and email of the signed-in account, when the runtime sends them.
 * A value that is only an internal ID is never returned. Use `accountLabel` for the fallback.
 */
export function accountNames(status: VerdictanStatus | undefined) {
  const account = status?.account as
    (NonNullable<VerdictanStatus['account']> & { email?: unknown }) | undefined;
  return {
    organization: serviceName(account?.organizationName),
    user: serviceName(account?.userName),
    email: serviceName(account?.userEmail, account?.email),
  };
}

/** Plain words for desktop.* account error codes. */
const accountErrors: Record<string, string> = {
  'desktop.secure_storage_unavailable':
    'Kalkidan did not get access to the system keychain. Select Check status, then allow access.',
  'desktop.browser_failed': 'The browser did not open. Select Sign in again.',
  'desktop.region_mismatch':
    'The saved account is in a different region. Sign out before you change the region.',
  'desktop.identity_mismatch':
    'The browser account is not the saved account. Use the same account, or sign out.',
  'desktop.auth_expired': 'Your session expired. Sign in again.',
  'desktop.auth_required': 'Sign in first.',
  'desktop.request_timeout':
    'Managed agents did not reply in time. Check the status, then try again.',
  'desktop.operation_in_progress':
    'Another account operation is in progress. Wait for it to finish.',
  'desktop.setup_invalid':
    'The setup choices from your organization are not valid. Try again later.',
  'desktop.setup_selection_required':
    'Choose an agent or a team and policy, a connection, and a model. Then save.',
  'desktop.cancel_failed': 'Could not cancel the sign-in. Check the status.',
};

export function verdictanErrorMessage(code: string) {
  return managedErrors[code]?.message || accountErrors[code] || managedErrorInfo(code).message;
}

/** Each managed-agent step and if it is done. */
export interface ManagedSteps {
  runtime: boolean;
  signedIn: boolean;
  codex: boolean;
  claude: boolean;
}

/**
 * True when the managed agents runtime is installed on the computer. This is the one source of
 * the runtime state: the installer status, not the account phase.
 */
export function runtimeReady(runtime: ComponentUpdateStatus | undefined) {
  return !!runtime?.installed;
}

/**
 * Each managed-agent step and if it is done. `runtime` is the installer status of this
 * computer (`runtimeUpdateStatus`). Without it, the account phase is a fallback.
 */
export function managedSteps(
  status: VerdictanStatus | undefined,
  setup: VerdictanSetup | undefined,
  runtime?: ComponentUpdateStatus,
): ManagedSteps {
  const signedIn = status?.phase === 'authenticated';
  return {
    runtime: runtime
      ? runtimeReady(runtime)
      : !!status && status.phase !== 'missing' && status.phase !== 'checking',
    signedIn,
    // A saved choice that needs a new agent, for example a removed default, is not done. The
    // agent of this computer is for both coding agents.
    codex:
      signedIn &&
      !!setup &&
      !selectionIssue(setup, setup.selections.codex) &&
      !computerAgentIssue(setup, localComputer),
    claude:
      signedIn &&
      !!setup &&
      !selectionIssue(setup, setup.selections.claude) &&
      !computerAgentIssue(setup, localComputer),
  };
}

/**
 * The call to action of an empty memory page. When managed agents are ready, a chat in the
 * project can add memory. When a setup step is not done, the setup comes first. An unknown
 * state gets no action.
 */
export function memoryEmptyAction(
  steps: ManagedSteps | undefined,
): 'start-chat' | 'set-up' | undefined {
  if (!steps) return undefined;
  return steps.runtime && steps.signedIn && (steps.codex || steps.claude) ? 'start-chat' : 'set-up';
}
