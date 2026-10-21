import type { BuiltinAgent } from '../config/agents';
import type { TrackerItem } from './tracker';
export interface ChatOptions {
  operationId?: string;
  forkFrom?: string;
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
}
export interface Session {
  governanceScope?: { projectId: string; taskId?: string };
  forkFrom?: string;
  hostId?: string;
  id: string;
  agent: Agent;
  cwd: string;
  updatedAt: string;
  title: string;
  organization?: SessionOrganization;
  projectId?: string;
  task?: TrackerItem;
  initialPrompt?: string;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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
  status: 'loading' | 'current' | 'reconciling' | 'unavailable';
  requests: {
    id: string;
    policy: string | null;
    usage: string | null;
    audit: string | null;
    actualCost: string | null;
    currency: string | null;
    tokens: string | null;
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
  errorCode?: 'session_busy' | 'transport_lost';
  sessionReady?: boolean;
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
}

export interface GitHubCliStatus {
  status: 'ready' | 'signed-out' | 'missing' | 'error' | 'unavailable';
  path?: string;
}
