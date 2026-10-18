import type { BuiltinAgent } from '../config/agents';
import type { TrackerItem } from './tracker';
export interface ChatOptions {
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
export interface ChatRun {
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
  errorCode?: 'session_busy';
  sessionReady?: boolean;
}
export interface AgentInstallation {
  agent: Agent;
  status: 'installed' | 'missing' | 'unavailable';
  path?: string;
}

export interface GitHubCliStatus {
  status: 'ready' | 'signed-out' | 'missing' | 'error' | 'unavailable';
  path?: string;
}
