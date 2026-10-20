export type UpdatePhase =
  | 'requested'
  | 'downloading'
  | 'verifying'
  | 'staged'
  | 'waiting-for-idle'
  | 'activating'
  | 'validating'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'interrupted'
  | 'unknown-outcome'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed';
export interface ComponentRelease {
  version: string;
  releaseId: string;
  sha256: string;
}
export interface UpdateOperation {
  id: string;
  generation: number;
  sequence: number;
  hostId: string;
  component: 'verdictan' | 'desktop' | 'ssh-helper';
  phase: UpdatePhase;
  previous?: ComponentRelease;
  target: ComponentRelease;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
  error?: string;
}
export interface ComponentUpdateStatus {
  hostId: string;
  component: UpdateOperation['component'];
  discovery: 'unknown' | 'checking' | 'current' | 'available' | 'blocked' | 'failed';
  installed?: ComponentRelease;
  running?: ComponentRelease;
  approved?: ComponentRelease;
  discovered?: ComponentRelease;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  stale: boolean;
  operation?: UpdateOperation;
  history: UpdateOperation[];
  error?: string;
}
export interface UpdatesAPI {
  componentUpdates(force?: boolean): Promise<ComponentInventory>;
  runtimeUpdateStatus(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateCheck(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateInstall(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateCancel(hostId?: string): Promise<ComponentUpdateStatus>;
}

export interface DesktopUpdateStatus {
  installedVersion: string;
  runningVersion: string;
  runningBuild: string;
  discovery: 'unknown' | 'checking' | 'current' | 'available' | 'failed' | 'unsupported';
  stale: boolean;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  release?: { version: string; id: string; url: string; sha256: string; publishedAt: string };
  error?: string;
}
export interface HelperUpdateStatus {
  hostId: string;
  name: string;
  connected: boolean;
  installed?: string;
  running?: string;
  approved: string;
  discovery: 'unknown' | 'current' | 'available' | 'waiting-for-idle';
}
export interface ComponentInventory {
  desktop: DesktopUpdateStatus;
  helpers: HelperUpdateStatus[];
}
