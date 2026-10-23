// The outcome of the latest run of each chat. The main process keeps it. The status dots use it.
import type { ChatRun } from './conversation';
import { managedErrorCode, managedErrorInfo, managedRefusal } from './verdictan';

/** How the latest run of a chat ended. */
export type ChatOutcomeKind = 'completed' | 'failed' | 'refused' | 'stopped';
export const chatOutcomeKinds: readonly ChatOutcomeKind[] = [
  'completed',
  'failed',
  'refused',
  'stopped',
];
/**
 * A safe reason for a failed run. It is a short category or a managed agent code. It never
 * contains text from the provider or the agent.
 */
export type ChatFailureReason =
  | 'agent_error'
  | 'api_error'
  | 'gateway_refused'
  | 'permission_denied'
  | 'session_busy'
  | 'timeout'
  | 'transport_lost'
  | `desktop.${string}`;
export const chatFailureReasons: readonly ChatFailureReason[] = [
  'agent_error',
  'api_error',
  'gateway_refused',
  'permission_denied',
  'session_busy',
  'timeout',
  'transport_lost',
];
export interface ChatOutcome {
  outcome: ChatOutcomeKind;
  /** For `failed`: a failure reason. For `refused`: the refusal code. */
  reason?: string;
  /** The time when the run ended, as an ISO string. */
  at: string;
}
/** One stored outcome: the chat, its agent and host, and the outcome of its latest run. */
export interface ChatOutcomeRecord extends ChatOutcome {
  agent: string;
  /** The session ID. A remote session ID has the form `<hostId>::<provider ID>`. */
  id: string;
  hostId?: string;
  /** The run that made this outcome. It prevents a second write for the same run. */
  runId?: string;
}

const managedCode = /^desktop\.[a-z_]{1,100}$/;
/** True for a reason that is safe to keep and to show. */
export function safeOutcomeReason(outcome: ChatOutcomeKind, reason: unknown) {
  if (reason === undefined) return true;
  if (typeof reason !== 'string') return false;
  if (outcome === 'refused') return managedCode.test(reason);
  if (outcome === 'failed')
    return managedCode.test(reason) || chatFailureReasons.includes(reason as ChatFailureReason);
  return false;
}

/** The safe failure reason of a failed run. It reads codes first, then known error forms. */
export function failureReason(run: Pick<ChatRun, 'error' | 'errorCode'>): ChatFailureReason {
  const code = run.errorCode;
  if (code === 'transport_lost' || code === 'session_busy') return code;
  if (code && managedCode.test(code)) return code as `desktop.${string}`;
  const text = typeof run.error === 'string' ? run.error : '';
  if (/stopped after an earlier refusal|requires a new evaluation/i.test(text))
    return 'gateway_refused';
  const managed = managedErrorCode(text);
  if (managed) return managed as `desktop.${string}`;
  if (/denied by the agent permission policy/i.test(text)) return 'permission_denied';
  if (/\btimed out\b/i.test(text)) return 'timeout';
  if (/\bAPI Error\b|\b(?:429|5\d\d)\b|overloaded|rate.?limit/i.test(text)) return 'api_error';
  if (/remote connection was lost|SSH disconnected/i.test(text)) return 'transport_lost';
  return 'agent_error';
}

/**
 * The outcome of a run that ended. A running run has no outcome. A blocked managed launch is a
 * refusal. Its reason is the safe refusal code.
 */
export function chatOutcomeOf(
  run: Pick<ChatRun, 'status' | 'error' | 'errorCode' | 'managedCode'>,
  at = new Date().toISOString(),
): ChatOutcome | undefined {
  if (run.status === 'running') return undefined;
  if (run.status === 'completed') return { outcome: 'completed', at };
  if (run.status === 'stopped') return { outcome: 'stopped', at };
  if (run.errorCode === 'managed_launch_blocked') {
    const code =
      run.managedCode && managedCode.test(run.managedCode)
        ? run.managedCode
        : managedErrorCode(run.error) || 'desktop.launch_blocked';
    return { outcome: 'refused', reason: code, at };
  }
  return { outcome: 'failed', reason: failureReason(run), at };
}

const failureWords: Record<Exclude<ChatFailureReason, `desktop.${string}`>, string> = {
  agent_error: 'The agent stopped because of an error.',
  api_error: 'The model provider sent an error.',
  gateway_refused: 'The Verdictan gateway stopped this turn after a refusal.',
  permission_denied: 'The agent permission policy declined an action.',
  session_busy: 'A different app has this chat open.',
  timeout: 'The agent did not respond in time.',
  transport_lost: 'The connection to the computer stopped.',
};

/** Plain words for a failed or refused outcome, for the tooltip of the status dot. */
export function outcomeLabel(outcome: Pick<ChatOutcome, 'outcome' | 'reason'>) {
  if (outcome.outcome === 'refused') {
    const code = outcome.reason && managedCode.test(outcome.reason) ? outcome.reason : '';
    const detail = code
      ? managedRefusal(code).message
      : 'The Verdictan launch checks did not pass.';
    return `Verdictan did not start the last run. ${detail}`;
  }
  if (outcome.outcome === 'failed') {
    const reason = outcome.reason || 'agent_error';
    const detail = managedCode.test(reason)
      ? managedErrorInfo(reason).message
      : failureWords[reason as keyof typeof failureWords] || failureWords.agent_error;
    return `The last run failed. ${detail}`;
  }
  return outcome.outcome === 'stopped' ? 'You stopped the last run.' : 'The last run completed.';
}

/** The live state of an open chat: work in progress, or a wait for the user. */
export type LiveChatState = 'running' | 'approval' | 'question';
/** The status of a chat row. */
export type ChatRowStatus = LiveChatState | 'failed' | 'refused' | 'done';
/**
 * The status of a chat row. Work in progress and a wait for the user come first. Then a failed
 * or refused latest run. Then a finished run that the user did not open yet. Opening the chat
 * removes only the last one. A new run that completes replaces a failed or refused outcome.
 */
export function chatRowStatus(input: {
  live?: LiveChatState;
  outcome?: Pick<ChatOutcome, 'outcome'>;
  unseen?: boolean;
}): ChatRowStatus | undefined {
  if (input.live) return input.live;
  if (input.outcome?.outcome === 'failed' || input.outcome?.outcome === 'refused')
    return input.outcome.outcome;
  return input.unseen ? 'done' : undefined;
}
