// Plain words for errors from agents and from managed agents. The UI never shows a code alone.
import { errorMessage } from './errors';
import { managedErrorCode, managedErrorInfo } from '../domain/verdictan';

export type AgentErrorActionKind = 'settings' | 'retry' | 'change-agent' | 'install';

export interface AgentErrorAction {
  label: string;
  /** The Settings section to open, for `settings` and `install`. */
  section?: string;
  kind: AgentErrorActionKind;
}

export interface AgentError {
  message: string;
  action?: AgentErrorAction;
  /** The code from the desktop or the runtime, for the details. Never show it alone. */
  code?: string;
}

const setUp: AgentErrorAction = {
  label: 'Set up managed agents',
  section: 'managed-agents',
  kind: 'settings',
};
const retry: AgentErrorAction = { label: 'Try again', kind: 'retry' };
const install: AgentErrorAction = { label: 'How to install', section: 'agents', kind: 'install' };
const changeAgent: AgentErrorAction = { label: 'Change agent', kind: 'change-agent' };
const sectionActions: Record<string, AgentErrorAction> = {
  'managed-agents': { label: 'Open managed agents', section: 'managed-agents', kind: 'settings' },
  agents: { label: 'Open agent settings', section: 'agents', kind: 'settings' },
  updates: { label: 'Open updates', section: 'updates', kind: 'settings' },
};
// Codes that a new chat with the other agent can fix.
const changeAgentCodes = new Set([
  'desktop.subscription_agent_required',
  'desktop.resume_incompatible',
  'desktop.resume_binding_required',
  'desktop.runtime_binding_mismatch',
]);

/** Plain words and one action for a managed agent code. Uses the backend's code list. */
function managedError(code: string): AgentError {
  const info = managedErrorInfo(code);
  const action = changeAgentCodes.has(code)
    ? changeAgent
    : code === 'desktop.runtime_missing' || code === 'desktop.runtime_not_found'
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

const agentNames: Record<string, string> = { codex: 'Codex', claude: 'Claude Code' };

/**
 * Returns plain words and one action for an error from a chat. Desktop codes look like
 * `desktop.runtime_missing`. `agent` is the agent ID, for the messages about installs.
 */
export function agentErrorMessage(error: unknown, agent?: string): AgentError {
  const text = errorMessage(error).trim();
  const name = (agent && agentNames[agent]) || 'The agent';
  const code = managedErrorCode(text);
  if (code) return managedError(code);
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
      action: { label: 'Change agent', kind: 'change-agent' },
    };
  return { message: text || `${name} could not reply.`, action: retry };
}
