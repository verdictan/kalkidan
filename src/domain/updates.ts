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
  /**
   * True when an SSH host cannot reach the release server. The desktop can then download and
   * verify the release, and copy it to the host over the SSH connection.
   */
  canTransfer?: boolean;
  /** The progress of a copy from this computer to the SSH host, while the copy runs. */
  transfer?: RuntimeTransferProgress;
}
/** The steps of a copy of the runtime from this computer to an SSH host. */
export interface RuntimeTransferProgress {
  phase: 'downloading' | 'verifying' | 'copying' | 'installing';
  /** Bytes done in this step. */
  bytes: number;
  /** Bytes of the runtime archive. */
  totalBytes: number;
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
  /** Download and verify the release on this computer, then copy it to an SSH host. */
  runtimeUpdateTransfer(hostId: string): Promise<ComponentUpdateStatus>;
  /** Listens for a proxy that asks for a user name and password. Returns the unsubscribe. */
  onProxyLogin?(listener: (request: ProxyLoginRequest) => void): () => void;
  /** Answers a proxy sign-in request. Null cancels it. */
  proxyLoginAnswer?(id: string, answer: ProxyLoginAnswer | null): Promise<void>;
  /** The saved proxy sign-ins, without passwords. */
  proxySignIns?(): Promise<{ proxy: string; username: string }[]>;
  /** Removes the saved sign-in of a proxy (`host:port`). */
  proxySignInRemove?(proxy: string): Promise<void>;
}
/** A proxy asks for a sign-in before a release download can continue. */
export interface ProxyLoginRequest {
  id: string;
  host: string;
  port: number;
  realm: string;
  /** False when the OS has no secret store, so the password cannot be saved. */
  canSave: boolean;
}
export interface ProxyLoginAnswer {
  username: string;
  password: string;
  /** Save the sign-in in the OS secret store for the next downloads. */
  remember: boolean;
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
