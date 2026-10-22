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
  component: 'verdictan' | 'ssh-helper';
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
  /** The newest published release that has a valid Verdictan release signature. */
  latest?: ComponentRelease;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  stale: boolean;
  operation?: UpdateOperation;
  history: UpdateOperation[];
  error?: string;
  /** True when the latest release is not installed and Kalkidan can install it now. */
  canInstall?: boolean;
  /** Plain words for why the latest release cannot be installed now. */
  reason?: string;
  /**
   * True while an install runs on the host, also before its first journal entry. Read the status
   * again until it is false.
   */
  installing?: boolean;
}
export interface UpdatesAPI {
  /** The version and build of the running Kalkidan app. */
  appVersion(): Promise<AppVersion>;
  /** The helper state of each SSH host. Kalkidan compares digests. It does not download. */
  helperUpdates(): Promise<HelperUpdateStatus[]>;
  runtimeUpdateStatus(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateCheck(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateInstall(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateCancel(hostId?: string): Promise<ComponentUpdateStatus>;
}

/** The running Kalkidan app, for Settings › General › About. */
export interface AppVersion {
  version: string;
  /** The SHA-256 digest of the main process bundle, or "unknown". */
  build: string;
  /** False for a development build. */
  packaged: boolean;
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
