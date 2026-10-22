// Plain words for errors from agents and from managed agents. The UI never shows a code alone.
import { errorMessage } from './errors';
import {
  keychainRefusedCode,
  managedErrorCode,
  managedErrorInfo,
  managedOnlyNotice,
  managedRefusal,
  managedSetupStep,
  managedSetupTargets,
  versionAgent,
  type ManagedSetupStep,
  type RefusalContext,
} from '../domain/verdictan';
import { agentProgramAnchor, chooseProgramLabel } from '../domain/agent-programs';

export type AgentErrorActionKind =
  'settings' | 'retry' | 'change-agent' | 'install' | 'sign-in' | 'check-status';

export interface AgentErrorAction {
  label: string;
  /** The Settings section to open, for `settings` and `install`. `sign-in` opens no section. */
  section?: string;
  /** The element in the section that gets focus, for example one managed setup step. */
  anchor?: string;
  kind: AgentErrorActionKind;
}

export interface AgentError {
  message: string;
  action?: AgentErrorAction;
  /** The code from the desktop or the runtime, for the details. Never show it alone. */
  code?: string;
  /** A short secondary text, for example why Kalkidan does not start a local agent CLI. */
  note?: string;
  /** True when "Try again" is the first fix. It shows before a Settings action. */
  retryFirst?: boolean;
}

const setUp: AgentErrorAction = {
  label: 'Set up managed agents',
  section: 'account',
  kind: 'settings',
};
const retry: AgentErrorAction = { label: 'Try again', kind: 'retry' };
const install: AgentErrorAction = { label: 'How to install', section: 'agents', kind: 'install' };
const changeAgent: AgentErrorAction = { label: 'Use another agent', kind: 'change-agent' };
/** Starts the Verdictan sign-in. The sign-in flow listens for `kalkidan-sign-in`. */
const signIn: AgentErrorAction = { label: 'Sign in', kind: 'sign-in' };
/**
 * Checks the account again on this computer and on each SSH host. After a refused keychain
 * prompt, this starts the runtime again, so the system asks again.
 */
const checkStatus: AgentErrorAction = { label: 'Check status', kind: 'check-status' };
const sectionActions: Record<string, AgentErrorAction> = {
  'managed-agents': { label: 'Open account settings', section: 'account', kind: 'settings' },
  account: { label: 'Open account settings', section: 'account', kind: 'settings' },
  accounts: { label: 'Open account settings', section: 'account', kind: 'settings' },
  agents: { label: 'Open agent settings', section: 'agents', kind: 'settings' },
  computers: { label: 'Open computer settings', section: 'computers', kind: 'settings' },
};
// Codes that a Verdictan sign-in fixes, with the words for the chat.
const signInCodes: Record<string, string> = {
  'desktop.auth_required': 'Sign in to Verdictan to run agents.',
  'desktop.auth_expired': 'Your Verdictan sign-in expired. Sign in again to run agents.',
  'desktop.session_rejected': 'Your Verdictan sign-in expired. Sign in again to run agents.',
  'desktop.account_invalid': 'Sign in to Verdictan again to run agents.',
  'desktop.authorization_timeout': 'The sign-in did not finish. Sign in again to run agents.',
};
/** Plain words and the Sign in action for a code that a sign-in fixes. */
function signInError(code: string): AgentError | undefined {
  const message = signInCodes[code];
  return message ? { message, action: signIn, code } : undefined;
}
// Codes that a new chat with the other agent can fix.
const changeAgentCodes = new Set([
  'desktop.subscription_agent_required',
  'desktop.resume_incompatible',
  'desktop.resume_binding_required',
  'desktop.runtime_binding_mismatch',
]);

// Codes of a first setup that is not complete. A missing region is a setup step only while
// no region is saved.
const setUpCodes = new Set(['desktop.runtime_missing', 'desktop.runtime_not_found']);
/** What Kalkidan knows about the account. A saved region changes some fixes to Sign in. */
export interface AgentErrorContext {
  regionSaved?: boolean;
}

// Codes of a check, a gateway or a lock that did not become ready. They are not setup steps.
const refusalCodes =
  /^desktop\.(readiness_\w+|evidence_unavailable|event_authority_unavailable|operation_in_progress|secure_storage_unavailable)$/;

/** Plain words and one action for a managed agent code. Uses the backend's code list. */
function managedError(code: string, context: AgentErrorContext = {}): AgentError {
  const signInFix = signInError(code);
  if (signInFix) return signInFix;
  const { regionSaved } = context;
  const info = managedErrorInfo(code, { regionSaved });
  // A launch refusal code has its own words and step. Only a step that can help shows.
  const refusal = refusalCodes.test(code) ? managedRefusal(code, { regionSaved }) : undefined;
  if (refusal)
    return {
      message: refusal.message,
      action:
        code === keychainRefusedCode
          ? checkStatus
          : refusal.step
            ? stepAction(refusal.step, context)
            : refusal.retry
              ? retry
              : undefined,
      retryFirst: refusal.retry,
      code,
    };
  const action = info.signIn
    ? signIn
    : changeAgentCodes.has(code)
      ? changeAgent
      : setUpCodes.has(code) || (code === 'desktop.region_required' && !regionSaved)
        ? setUp
        : code === 'desktop.agent_version_unsupported'
          ? install
          : info.section
            ? sectionActions[info.section]
            : info.retry
              ? retry
              : undefined;
  return { message: info.message, action, code };
}

/** The Settings action for a setup step. */
function stepAction(step: ManagedSetupStep, context: AgentErrorContext = {}): AgentErrorAction {
  const fixed = managedSetupStep(step, { regionSaved: context.regionSaved });
  if (fixed === 'sign-in') return signIn;
  const target = managedSetupTargets[fixed] || managedSetupTargets.status;
  return { label: target.label, section: target.section, anchor: target.anchor, kind: 'settings' };
}

/** A blocked managed launch, as the desktop reports it in a chat run. */
export interface ManagedLaunchFailure {
  /** The text from the desktop. It starts with the managed-only notice. */
  message: string;
  step?: ManagedSetupStep;
  /** The safe code that stopped the launch. Older desktop apps do not send it. */
  code?: string;
  /** The agent version that the launch found. */
  version?: string;
  /** The path of the agent program that the launch checked. */
  path?: string;
}

/**
 * Plain words and one action for a blocked managed launch. The managed-only notice is a note,
 * not the first words. With the code, the words name the computer and the exact cause, and only
 * a step that can help shows. Without the code, the step from the desktop shows.
 */
export function managedLaunchError(
  failure: ManagedLaunchFailure,
  context: Omit<RefusalContext, 'version' | 'path'> & { hostId?: string } = {},
): AgentError {
  if (failure.code && /^desktop\.[a-z_]{1,100}$/.test(failure.code)) {
    const signInFix = signInError(failure.code);
    if (signInFix) return { ...signInFix, note: managedOnlyNotice };
    const { hostId, ...words } = context;
    const regionContext = { regionSaved: context.regionSaved };
    const refusal = managedRefusal(failure.code, {
      ...words,
      remote: !!hostId,
      version: failure.version,
      path: failure.path,
    });
    // A version refusal opens Settings › Agents at the program of that agent on that computer.
    const kind = versionAgent(failure.code);
    const agent = kind === 'claude_code' ? 'claude' : kind;
    return {
      message: refusal.message,
      note: managedOnlyNotice,
      action: agent
        ? {
            label: chooseProgramLabel(agent),
            section: 'agents',
            anchor: agentProgramAnchor(agent, hostId),
            kind: 'settings',
          }
        : failure.code === keychainRefusedCode
          ? checkStatus
          : refusal.step
            ? stepAction(refusal.step, regionContext)
            : undefined,
      retryFirst: refusal.retry,
    };
  }
  const text = failure.message.replace(/\s*managed_launch_blocked\s*$/, '').trim();
  const message = text.startsWith(managedOnlyNotice)
    ? text.slice(managedOnlyNotice.length).trim()
    : text;
  return {
    message: message || 'The managed launch checks did not pass.',
    note: managedOnlyNotice,
    action: stepAction(failure.step || 'status', { regionSaved: context.regionSaved }),
  };
}

const agentNames: Record<string, string> = { codex: 'Codex', claude: 'Claude Code' };

/**
 * Returns plain words and one action for an error from a chat. Desktop codes look like
 * `desktop.runtime_missing`. `agent` is the agent ID, for the messages about installs.
 */
export function agentErrorMessage(
  error: unknown,
  agent?: string,
  context: AgentErrorContext = {},
): AgentError {
  const text = errorMessage(error).trim();
  const name = (agent && agentNames[agent]) || 'The agent';
  // A blocked managed launch already has plain words. Keep them and link to the setup.
  if (text.startsWith(managedOnlyNotice)) return managedLaunchError({ message: text }, context);
  const code = managedErrorCode(text);
  if (code) return managedError(code, context);
  if (/verdictan is not ready|managed agents? (are|is) not (ready|set up)/i.test(text))
    return {
      message: 'Managed agents are not set up. Set them up to start this chat.',
      action: setUp,
    };
  if (/session_busy|already (running|active)|is busy/i.test(text))
    return {
      message: `${name} is still working in another window. Wait for it to finish, then try again.`,
      action: retry,
      code: 'session_busy',
    };
  if (/transport_lost|connection (was )?lost|ECONNRESET|EPIPE/i.test(text))
    return { message: `The connection to ${name} stopped. Try again.`, action: retry };
  if (/ENOENT|not installed|command not found|could not find (the )?(codex|claude)/i.test(text))
    return {
      message: `${name} is not installed on this computer, or Kalkidan cannot find it.`,
      action: install,
    };
  if (/not (signed|logged) in|log ?in required|unauthori[sz]ed|401|api key/i.test(text))
    return {
      message: `${name} is not signed in. Sign in to the agent, then try again.`,
      action: { label: 'Open agent settings', section: 'agents', kind: 'settings' },
    };
  if (/rate limit|429|quota|usage limit/i.test(text))
    return {
      message: `${name} reached a usage limit. Wait, or use a different agent.`,
      action: changeAgent,
    };
  return { message: text || `${name} could not reply.`, action: retry };
}
