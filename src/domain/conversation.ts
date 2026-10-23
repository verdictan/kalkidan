import type { BuiltinAgent } from '../config/agents';
import type { TrackerItem } from './tracker';
import type { ManagedSetupStep } from './verdictan';
import type { ChatOutcome } from './chat-outcome';
import type { PolicyRecord } from './policy-result';
import type { ChatLink } from './chat-fork';
export interface ChatOptions {
  operationId?: string;
  forkFrom?: string;
  /**
   * The chat that this new chat forks. Kalkidan gives its history to the agent as context with
   * the first message. The source can be on another computer or use another agent.
   */
  forkOf?: ChatLink;
  /** The last message of `forkOf` when the user forked. Later messages are not history. */
  forkUntil?: string;
  model?: string;
  taskId?: string;
}
export interface ModelOption {
  id: string;
  name: string;
}
export type Agent = BuiltinAgent;
export interface SessionOrganization {
  importHidden?: boolean;
  title?: string;
  notes?: string;
  collection?: string;
  pinned?: boolean;
  archived?: boolean;
  taskId?: string;
  /** The pull request opened from this session. */
  pullRequest?: {
    url: string;
    number?: number;
    state?: 'open' | 'merged' | 'closed';
    /** An open pull request that is not ready for review. */
    draft?: boolean;
    /** The CI checks at the last read. */
    checks?: 'pass' | 'fail' | 'pending';
  };
  /** The chat that this chat is a fork of. */
  forkedFrom?: ChatLink;
  /** The forks of this chat, oldest first. */
  forks?: ChatLink[];
}
export interface Session {
  governanceScope?: { projectId: string; taskId?: string };
  forkFrom?: string;
  /** For a new fork before its first message: the source chat. See ChatOptions.forkOf. */
  forkOf?: ChatLink;
  forkUntil?: string;
  hostId?: string;
  id: string;
  agent: Agent;
  cwd: string;
  updatedAt: string;
  title: string;
  organization?: SessionOrganization;
  /** How the latest run of this chat ended. The main process keeps it. */
  outcome?: ChatOutcome;
  /** A run of this chat that still runs on its SSH host. The chat view attaches to it. */
  liveRunId?: string;
  projectId?: string;
  task?: TrackerItem;
  initialPrompt?: string;
  /** The child runs of this session (Claude Code Task subagents, Codex sub-agents). */
  subagents?: import('./desktop').SubagentSession[];
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /**
   * A saved answer: the tool calls of its turn, oldest first, as the history file has them.
   * The chat shows them as "23 steps · 3 files edited" under the answer.
   */
  steps?: ToolActivity[];
  /** A saved answer: the files that the tool calls of its turn edited. */
  edited?: string[];
}
export interface Transcript {
  messages: ChatMessage[];
  truncated: boolean;
}
export interface ToolActivity {
  id: string;
  title: string;
  status: string;
  detail?: string;
  diff?: string;
}
export interface ChatApproval {
  scope?: 'request' | 'turn';
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}
export interface GovernanceEvidence {
  finalized?: boolean;
  /**
   * Set when the gateway removed policy decision or trail events from its full or expired disk
   * queue during this conversation. Usage records stay until Verdictan receives them.
   */
  bufferWarning?: { droppedEvents: number; expiredEvents: number };
  status: 'loading' | 'current' | 'reconciling' | 'unavailable';
  requests: {
    id: string;
    policy: string | null;
    usage: string | null;
    audit: string | null;
    actualCost: string | null;
    currency: string | null;
    tokens: string | null;
    /** Set when the user's own subscription pays. Provider charges are then not known. */
    billing?: 'subscription';
  }[];
}
export interface TaskUsageHistory {
  runId: string;
  hostId?: string;
  phase: TaskExecutionStatus['phase'];
  updatedAt: number;
  evidence: { observedAt: number; value: GovernanceEvidence }[];
}
export interface TaskExecutionStatus {
  id: string;
  phase: 'starting' | 'active' | 'ready-for-review' | 'launch-failed' | 'interrupted';
  sync: 'pending' | 'writing' | 'confirmed' | 'blocked' | 'unknown-outcome';
  message?: string;
  updatedAt: number;
}
export interface ChatRun {
  taskExecution?: TaskExecutionStatus;
  governance?: GovernanceEvidence;
  unsupportedRequests?: number;
  requests?: AgentQuestionRequest[];
  tools?: ToolActivity[];
  approvals?: ChatApproval[];
  diff?: string;
  id: string;
  agent: Agent;
  sessionId: string;
  status: 'running' | 'completed' | 'stopped' | 'failed';
  messages: ChatMessage[];
  activity: string;
  error?: string;
  /** `desktop.*` codes are managed agent errors. See managedErrors in verdictan.ts. */
  errorCode?: 'session_busy' | 'transport_lost' | 'managed_launch_blocked' | `desktop.${string}`;
  /**
   * True while the desktop has no connection to the SSH host of a run that continues there.
   * The state is the last state that the desktop received.
   */
  hostDetached?: boolean;
  /** With `managed_launch_blocked`: the setup step that can remove the block. */
  managedSetup?: ManagedSetupStep;
  /** With `managed_launch_blocked`: the safe code that stopped the launch. */
  managedCode?: `desktop.${string}`;
  /** With a version refusal: the agent version that the launch found. */
  agentVersion?: string;
  /** With a version refusal: the path of the agent program that the launch checked. */
  agentPath?: string;
  sessionReady?: boolean;
  /** The policy results of the refused or escalated requests in this run, oldest first. */
  policies?: PolicyRecord[];
  /** The subagents that this run started, oldest first. */
  subagents?: import('./desktop').SubagentSession[];
}
export interface AgentQuestion {
  id: string;
  label: string;
  question: string;
  kind: 'text' | 'single-choice' | 'multiple-choice';
  options: { label: string; description: string }[];
  allowOther: boolean;
  secret: boolean;
}
export interface AgentQuestionRequest {
  id: string;
  runId: string;
  provider: Agent;
  kind: 'question';
  status: 'pending' | 'submitting' | 'answered' | 'expired' | 'canceled';
  questions: AgentQuestion[];
}
export type AgentAnswers = Record<string, string[]>;
export interface AgentInstallation {
  agent: Agent;
  status: 'installed' | 'missing' | 'unavailable';
  path?: string;
  /** The version from `--version`. Missing when Kalkidan cannot read it. */
  version?: string;
  /**
   * How Kalkidan selected the program: automatic detection, the program that the user chose in
   * Settings › Agents, or the KALKIDAN_<AGENT>_PATH environment variable.
   */
  source?: 'automatic' | 'chosen' | 'environment';
  /** The chosen or configured path, also when that program is not available. */
  chosenPath?: string;
  /** The other programs that automatic detection found, with their versions. */
  candidates?: AgentCandidate[];
  /**
   * The subscription sign-in of the agent on that computer: the ChatGPT login of Codex, or the
   * Claude subscription login of Claude Code. Missing when Kalkidan cannot tell.
   */
  subscriptionLogin?: 'signed-in' | 'signed-out';
}
/** One program that Kalkidan found for an agent. */
export interface AgentCandidate {
  path: string;
  version?: string;
}

export interface GitHubCliStatus {
  status: 'ready' | 'signed-out' | 'missing' | 'error' | 'unavailable';
  path?: string;
  /** The GitHub login of the signed-in GitHub CLI account. Only when the status is ready. */
  login?: string;
}

/** The warning when the gateway removed policy records that Verdictan did not receive. */
export function eventBufferWarning(warning: NonNullable<GovernanceEvidence['bufferWarning']>) {
  const removed = warning.droppedEvents + warning.expiredEvents;
  const records = removed === 1 ? '1 policy record' : `${removed.toLocaleString()} policy records`;
  const cause =
    warning.droppedEvents && warning.expiredEvents
      ? 'the event buffer was full, and some records were older than 30 days'
      : warning.droppedEvents
        ? 'the event buffer was full'
        : 'the records were older than 30 days';
  return `Verdictan did not receive ${records}, because ${cause}. Usage records stay until Verdictan receives them. Check the network connection.`;
}
