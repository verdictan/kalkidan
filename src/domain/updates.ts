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
  componentUpdates(force?: boolean): Promise<ComponentInventory>;
  runtimeUpdateStatus(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateCheck(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateInstall(hostId?: string): Promise<ComponentUpdateStatus>;
  runtimeUpdateCancel(hostId?: string): Promise<ComponentUpdateStatus>;
  /** Downloads, verifies, and stages the available desktop release. It never restarts. */
  desktopUpdateDownload(): Promise<DesktopUpdateStatus>;
  desktopUpdateCancel(): Promise<DesktopUpdateStatus>;
  /** Stops work on this computer after confirmation, installs the staged release, restarts. */
  desktopUpdateRestart(): Promise<DesktopUpdateStatus>;
}

/** How this copy of Kalkidan was installed. It decides whether it can update itself. */
export type DesktopInstallKind =
  'mac-app' | 'windows-installer' | 'appimage' | 'deb' | 'portable' | 'development' | 'unsupported';
export interface DesktopInstall {
  kind: DesktopInstallKind;
  /** True when Kalkidan can download, stage, and install a release itself. */
  selfUpdate: boolean;
  /** Why the user must install the download manually. */
  reason?: string;
}
export type DesktopUpdatePhase =
  'downloading' | 'verifying' | 'staging' | 'staged' | 'restarting' | 'failed' | 'canceled';
export interface DesktopUpdateProgress {
  phase: DesktopUpdatePhase;
  version: string;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface DesktopUpdateStatus {
  installedVersion: string;
  runningVersion: string;
  runningBuild: string;
  discovery: 'unknown' | 'checking' | 'current' | 'available' | 'failed' | 'unsupported';
  stale: boolean;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  release?: {
    version: string;
    id: string;
    url: string;
    sha256: string;
    publishedAt: string;
    /** The installer or archive for this install kind, and its size in bytes. */
    asset?: string;
    size?: number;
  };
  error?: string;
  install: DesktopInstall;
  update?: DesktopUpdateProgress;
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
