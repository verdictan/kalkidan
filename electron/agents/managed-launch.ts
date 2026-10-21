import type { Session, ChatRun } from '../../src/domain/conversation';
import type { executable } from '../chat';

export interface ManagedLaunchRequest {
  session: Session;
  runId: string;
  create: boolean;
  allowEdits: boolean;
  forkFrom?: string;
  model?: string;
  internal: boolean;
  executable: Awaited<ReturnType<typeof executable>>;
  memoryURL?: string;
  stop(): Promise<void>;
  signal: AbortSignal;
}
export interface ManagedLaunch {
  executable: string;
  prefix: string[];
  args: string[];
  env: NodeJS.ProcessEnv;
  model: string;
  bindNativeSession(id: string): Promise<void>;
  redact(text: string): string;
  finish(): Promise<void>;
  observe?(state: ChatRun): void;
  /** Called after spawn. It removes short-lived native credentials from the launch data. */
  launched?(): void;
}
export type PrepareManagedLaunch = (request: ManagedLaunchRequest) => Promise<ManagedLaunch>;
