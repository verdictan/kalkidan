// Plain words for errors from the agent CLIs and from the Verdictan gateway. The UI never shows
// a code alone. Round 11: Kalkidan does not set up agents. A missing agent CLI links to its
// install guide and Settings › Tools, a gateway runtime failure has "Try again" (it repairs
// the runtime first), and a missing sign-in shows the sign-in card.
import { errorMessage } from './errors';
import {
  keychainRefusedCode,
  managedErrorCode,
  managedErrorInfo,
  managedOnlyNotice,
  managedRefusal,
  managedSetupStep,
  versionAgent,
  type ManagedSetupStep,
  type RefusalContext,
} from '../domain/verdictan';
import { toolInstallUrls, toolNames } from '../domain/desktop';

export type AgentErrorActionKind =
  | 'settings'
  | 'retry'
  | 'change-agent'
  | 'install'
  | 'sign-in'
  | 'check-status'
  | 'fork'
  | 'gateway-retry';

export interface AgentErrorAction {
  label: string;
  /** The Settings part to open, for `settings` and `install`. `sign-in` opens no part. */
  section?: string;
  /** The element in the part that gets focus. */
  anchor?: string;
  /** The official install guide, for `install`. */
  url?: string;
  kind: AgentErrorActionKind;
}

export interface AgentError {
  message: string;
  action?: AgentErrorAction;
  /** The code from the desktop or the runtime, for the details. Never show it alone. */
  code?: string;
  /** A short secondary text, for example how Kalkidan runs the agent CLI. */
  note?: string;
  /** True when "Try again" is the first fix. It shows before a Settings action. */
  retryFirst?: boolean;
}

/** Settings › Tools: the agent CLIs of each computer with their state. */
const toolsSettings: AgentErrorAction = {
  label: 'Open Tools settings',
  section: 'tools',
  kind: 'settings',
};
/**
 * The gateway runtime failed. Kalkidan installs and repairs it by itself: "Try again" repairs it
 * (`gatewayRuntimeRetry`), then sends the message again.
 */
const gatewayRetry: AgentErrorAction = { label: 'Try again', kind: 'gateway-retry' };
const retry: AgentErrorAction = { label: 'Try again', kind: 'retry' };
const changeAgent: AgentErrorAction = { label: 'Use another agent', kind: 'change-agent' };
/** Starts the Verdictan sign-in. The chat shows the sign-in card for it. */
const signIn: AgentErrorAction = { label: 'Sign in', kind: 'sign-in' };
/**
 * Checks the account again on this computer and on each SSH host. After a refused keychain
 * prompt, this starts the runtime again, so the system asks again.
 */
const checkStatus: AgentErrorAction = { label: 'Check status', kind: 'check-status' };

const agentNames: Record<string, string> = { codex: 'Codex', claude: 'Claude Code' };
/** The agent ID of a name or a version kind: 'codex', 'claude', or undefined. */
function agentId(agent?: string) {
  if (agent === 'claude_code') return 'claude';
  return agent === 'codex' || agent === 'claude' ? agent : undefined;
}
/** "Install guide ↗" for the agent CLI, with "Tools…" beside it. */
function installGuide(agent?: string): AgentErrorAction {
  const id = agentId(agent);
  return {
    label: 'Install guide',
    section: 'tools',
    kind: 'install',
    ...(id ? { url: toolInstallUrls[id] } : {}),
  };
}
/** "Codex is not installed." with its install guide. */
export function missingAgentError(agent?: string, code?: string): AgentError {
  const id = agentId(agent);
  const name = id ? toolNames[id] : 'The agent';
  return {
    message: `${name} is not installed. Install it, then restart Kalkidan to find it.`,
    action: installGuide(id),
    ...(code ? { code } : {}),
  };
}

// Codes of an agent CLI that the launch did not find or could not run.
const missingAgentCodes = new Set([
  'desktop.agent_not_found',
  'desktop.executable_invalid',
  'desktop.agent_home_invalid',
]);
// Codes that a Verdictan sign-in fixes, with the words for the chat.
const signInCodes: Record<string, string> = {
  'desktop.auth_required': 'Sign in to Verdictan to run agents.',
  'desktop.auth_expired': 'Your Verdictan sign-in expired. Sign in again to run agents.',
  'desktop.session_rejected': 'Your Verdictan sign-in expired. Sign in again to run agents.',
  'desktop.account_invalid': 'Sign in to Verdictan again to run agents.',
  'desktop.authorization_timeout': 'The sign-in did not finish. Sign in again to run agents.',
};
/** Opens the fork dialog of the chat. The fork continues with the agent of this computer. */
const fork: AgentErrorAction = { label: 'Fork chat', kind: 'fork' };
/**
 * Verdictan refused the agent connection of one chat, for example after its gateway moved to
 * another agent. The account is still signed in, so a sign-in does not help.
 */
const refusedConnection: AgentError = {
  message:
    "This chat's agent connection was refused. Try again, or fork the chat to continue it with the agent of this computer.",
  action: fork,
  retryFirst: true,
  code: 'desktop.session_rejected',
};
/**
 * Plain words and the Sign in action for a code that a sign-in fixes. A rejected session of a
 * signed-in account is a refused agent connection, not an expired sign-in.
 */
function signInError(code: string, context: AgentErrorContext = {}): AgentError | undefined {
  if (code === 'desktop.session_rejected' && context.signedIn) return refusedConnection;
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
// Codes of a computer that cannot isolate agents. No action helps.
const platformCodes = new Set([
  'desktop.clock_skew',
  'desktop.process_isolation_unavailable',
  'desktop.isolation_scope_invalid',
  'desktop.loopback_required',
  'desktop.protected_pipe_unavailable',
]);
/** What Kalkidan knows about the account. A saved region changes some fixes to Sign in. */
export interface AgentErrorContext {
  regionSaved?: boolean;
  /** True when the Verdictan account is signed in now. Then a sign-in does not fix an error. */
  signedIn?: boolean;
  /** The agent of the chat ('codex' or 'claude'), for the install guide. */
  agent?: string;
}

// Codes of a check, a gateway or a lock that did not become ready. They are not setup steps.
const refusalCodes =
  /^desktop\.(readiness_\w+|evidence_unavailable|event_authority_unavailable|operation_in_progress|secure_storage_unavailable)$/;

/** Plain words and one action for a gateway code. Uses the backend's code list. */
function managedError(code: string, context: AgentErrorContext = {}): AgentError {
  const signInFix = signInError(code, context);
  if (signInFix) return signInFix;
  const { regionSaved } = context;
  if (missingAgentCodes.has(code)) return missingAgentError(context.agent, code);
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
            ? stepAction(refusal.step, context, code)
            : refusal.retry
              ? retry
              : undefined,
      retryFirst: refusal.retry,
      code,
    };
  const version = versionAgent(code);
  const action = info.signIn
    ? signIn
    : changeAgentCodes.has(code)
      ? changeAgent
      : code === 'desktop.region_required' && !regionSaved
        ? signIn
        : version || code === 'desktop.agent_version_unsupported'
          ? installGuide(version || context.agent)
          : platformCodes.has(code)
            ? undefined
            : info.section === 'computers'
              ? gatewayRetry
              : info.section === 'agents'
                ? toolsSettings
                : info.section === 'account'
                  ? signIn
                  : info.retry
                    ? retry
                    : undefined;
  return { message: info.message, action, code };
}

/** The action for a setup step. Kalkidan has no agent setup: each step has one fix. */
function stepAction(
  step: ManagedSetupStep,
  context: AgentErrorContext = {},
  code?: string,
): AgentErrorAction | undefined {
  const fixed = managedSetupStep(step, { regionSaved: context.regionSaved });
  switch (fixed) {
    case 'region':
    case 'sign-in':
      return signIn;
    // The gateway runtime is not ready or stopped. Try again repairs it, then sends again.
    case 'runtime':
    case 'status':
      return gatewayRetry;
    case 'agents':
      return installGuide((code && versionAgent(code)) || context.agent);
    case 'agent-sign-in':
      return toolsSettings;
    // The agent policy is in Verdictan. Only an administrator can change it there.
    case 'agent-setup':
      return code && changeAgentCodes.has(code) ? changeAgent : retry;
  }
  return retry;
}

/** A blocked managed launch, as the desktop reports it in a chat run. */
export interface ManagedLaunchFailure {
  /** The text from the desktop. It starts with the gateway notice. */
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
 * Plain words and one action for a blocked launch. The gateway notice is a note, not the first
 * words. With the code, the words name the computer and the exact cause, and only a step that
 * can help shows. Without the code, the step from the desktop shows.
 */
export function managedLaunchError(
  failure: ManagedLaunchFailure,
  context: Omit<RefusalContext, 'version' | 'path'> & {
    hostId?: string;
    agent?: string;
    signedIn?: boolean;
  } = {},
): AgentError {
  if (failure.code && /^desktop\.[a-z_]{1,100}$/.test(failure.code)) {
    const signInFix = signInError(failure.code, { signedIn: context.signedIn });
    if (signInFix) return { ...signInFix, note: managedOnlyNotice };
    if (missingAgentCodes.has(failure.code))
      return { ...missingAgentError(context.agent), note: managedOnlyNotice };
    const { hostId, agent: _agent, signedIn: _signedIn, ...words } = context;
    const refusal = managedRefusal(failure.code, {
      ...words,
      remote: !!hostId,
      version: failure.version,
      path: failure.path,
    });
    // A version refusal links to the install guide of that agent and to Settings › Tools.
    const kind = versionAgent(failure.code);
    return {
      message: refusal.message,
      note: managedOnlyNotice,
      action: kind
        ? installGuide(kind)
        : failure.code === keychainRefusedCode
          ? checkStatus
          : platformCodes.has(failure.code)
            ? undefined
            : refusal.step
              ? stepAction(refusal.step, context, failure.code)
              : undefined,
      retryFirst: refusal.retry,
    };
  }
  const text = failure.message.replace(/\s*managed_launch_blocked\s*$/, '').trim();
  const message = text.startsWith(managedOnlyNotice)
    ? text.slice(managedOnlyNotice.length).trim()
    : text;
  return {
    message: message || 'The Verdictan launch checks did not pass. Try again.',
    note: managedOnlyNotice,
    action: stepAction(failure.step || 'status', context, failure.code),
  };
}

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
  const withAgent = { ...context, agent: context.agent || agent };
  // A blocked launch already has plain words. Keep them and show the one fix.
  if (text.startsWith(managedOnlyNotice)) return managedLaunchError({ message: text }, withAgent);
  const code = managedErrorCode(text);
  if (code) return managedError(code, withAgent);
  // The browser preview runs no agent. No action helps there.
  if (/browser preview cannot (start|run) agents/i.test(text)) return { message: text };
  if (
    /verdictan is not ready|gateway (runtime )?(is )?not ready|managed agents? (are|is) not (ready|set up)/i.test(
      text,
    )
  )
    return {
      message: 'The Verdictan gateway on this computer is not ready. Try again.',
      action: gatewayRetry,
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
    return missingAgentError(agent);
  if (/not (signed|logged) in|log ?in required|unauthori[sz]ed|401|api key/i.test(text))
    return {
      message: `${name} is not signed in. Sign in to ${name} in a terminal, then try again.`,
      action: toolsSettings,
    };
  if (/rate limit|429|quota|usage limit/i.test(text))
    return {
      message: `${name} reached a usage limit. Wait, or use a different agent.`,
      action: changeAgent,
    };
  return { message: text || `${name} could not reply.`, action: retry };
}
