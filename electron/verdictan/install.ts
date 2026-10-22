import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID, type KeyObject } from 'node:crypto';
import { withDirectoryLock } from '../storage/directory-lock';
import { writeJSON } from '../storage/atomic-json';
import type {
  ComponentRelease,
  ComponentUpdateStatus,
  UpdateOperation,
  UpdatePhase,
} from '../../src/domain/updates';
import {
  releaseDownloadOrigins,
  type ReleaseCheckpoint,
  type RuntimeDiscovery,
  type VerifiedRuntimeRelease,
} from './release';
import {
  fetchRuntimeRelease,
  verifyReleaseFiles,
  type ReleaseFiles,
  type SignedRuntimeRelease,
} from './release-source';
import { releasePublicKey, verifySignedFile } from './signature';
import { downloadRuntime, verifyRuntimeArchive } from './download';
import { isReleaseNetworkError } from './network';
import { extractRuntime } from './archive';
import { keychainRefusedCode, managedErrorText } from '../../src/domain/verdictan';

interface Receipt {
  schema: 1;
  release: ComponentRelease;
  executable: 'verdictan' | 'verdictan.exe';
  binaryDigest: string;
  checkpoint: ReleaseCheckpoint;
}
interface InstallationState {
  schema: 1;
  checkpoint?: ReleaseCheckpoint;
  active?: Receipt;
  previous?: Receipt;
  staged?: Receipt;
  operation?: UpdateOperation;
  history: UpdateOperation[];
  /** The revoked versions from the newest verified manifest. Launch checks them offline. */
  revoked?: string[];
}
export interface RuntimeInstallerOptions {
  root: string;
  hostId: string;
  desktopVersion: string;
  os: string;
  arch: string;
  systemVersion: string;
  busy(): boolean;
  /** Find the newest published release for this host. */
  discover(): Promise<RuntimeDiscovery | undefined>;
  /** The release signing key. Only tests replace it. */
  key?: KeyObject;
  probe(executable: string, version: string): Promise<void>;
  beforeActivate?(): Promise<void>;
  changed?(): void;
  now?: () => number;
  request?: typeof fetch;
  /** True when the desktop can copy a release to this host over SSH. */
  transferable?: boolean;
}
/** A release that the desktop downloaded, verified, and copied to this host. */
export interface TransferredRuntime {
  discovered: RuntimeDiscovery;
  files: ReleaseFiles;
  /** The received archive. It must be in the managed runtime directory. */
  archive: string;
}
const terminal = new Set<UpdatePhase>([
  'completed',
  'failed',
  'canceled',
  'rolled-back',
  'rollback-failed',
]);
/**
 * Installs the newest release that the Verdictan release key signs, and updates to newer signed
 * releases automatically. The journal is authoritative on its execution host.
 */
export class RuntimeInstaller {
  private state: InstallationState = { schema: 1, history: [] };
  private view: ComponentUpdateStatus;
  private checkPending?: Promise<ComponentUpdateStatus>;
  private installPending?: Promise<ComponentUpdateStatus>;
  // True from the install request until the journal has its final state. The status that the
  // install returns is then already free of it.
  private installRunning = false;
  private abort?: AbortController;
  private latest?: SignedRuntimeRelease;
  private assertOwned?: () => void;
  private now: () => number;
  constructor(private options: RuntimeInstallerOptions) {
    this.now = options.now || Date.now;
    this.view = {
      hostId: options.hostId,
      component: 'verdictan',
      discovery: 'unknown',
      stale: true,
      history: [],
    };
  }
  private async prepare() {
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    if ((await lstat(this.options.root)).isSymbolicLink())
      throw new Error('The managed runtime directory cannot be a symbolic link.');
    await mkdir(join(this.options.root, 'versions'), { recursive: true, mode: 0o700 });
    if ((await lstat(join(this.options.root, 'versions'))).isSymbolicLink())
      throw new Error('The runtime versions directory cannot be a symbolic link.');
  }
  private async readState(duringInstall = false) {
    try {
      const path = join(this.options.root, 'installation.json');
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await file.stat()).size > 1024 * 1024)
          throw new Error('Runtime history exceeds its size limit.');
        const state = JSON.parse(await file.readFile('utf8')) as InstallationState;
        if (state.schema !== 1 || !Array.isArray(state.history) || state.history.length > 100)
          throw new Error('Invalid runtime installation history.');
        for (const key of ['active', 'previous', 'staged'] as const) {
          const receipt = state[key];
          if (!receipt) continue;
          if (!validReceipt(receipt)) throw new Error('Invalid runtime receipt.');
          state[key] = {
            schema: 1,
            release: {
              version: receipt.release.version,
              releaseId: receipt.release.releaseId,
              sha256: receipt.release.sha256,
            },
            executable: receipt.executable,
            binaryDigest: receipt.binaryDigest,
            checkpoint: {
              sequence: receipt.checkpoint.sequence,
              digest: receipt.checkpoint.digest,
            },
          };
        }
        if (state.checkpoint && !validCheckpoint(state.checkpoint))
          throw new Error('Invalid runtime release checkpoint.');
        if (
          state.revoked !== undefined &&
          (!Array.isArray(state.revoked) ||
            state.revoked.length > 100 ||
            !state.revoked.every((value) => typeof value === 'string' && value.length <= 32))
        )
          throw new Error('Invalid runtime revocation list.');
        if (state.operation)
          state.operation = publicOperation(state.operation, this.options.hostId);
        state.history = state.history.map((operation) =>
          publicOperation(operation, this.options.hostId),
        );
        if (duringInstall || !this.installPending) this.state = state;
      } finally {
        await file.close();
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  status() {
    const result: ComponentUpdateStatus = structuredClone({
      ...this.view,
      installed: this.state.active?.release,
      operation: this.state.operation,
      history: this.state.history,
    });
    // An interrupted operation from an earlier process does not block. Install resumes it.
    const busy = this.installRunning || result.discovery === 'checking';
    // The journal can still show an earlier operation. This flag tells the UI to read again.
    if (this.installRunning) result.installing = true;
    const current = !!result.latest && result.installed?.sha256 === result.latest.sha256;
    result.canInstall = !!result.latest && !current && !busy;
    // A host that cannot reach the release server can get a copy from the desktop over SSH.
    if (
      this.options.transferable &&
      !busy &&
      !current &&
      (isReleaseNetworkError(result.error) ||
        (result.operation?.phase === 'failed' && isReleaseNetworkError(result.operation.error)))
    )
      result.canTransfer = true;
    result.reason = result.canInstall
      ? undefined
      : !result.latest
        ? result.error || 'No Verdictan release is known yet. Check for updates.'
        : current
          ? `Version ${result.latest.version} is installed.`
          : 'An install or check is in progress. Wait for it to finish.';
    if (
      !this.installRunning &&
      result.operation &&
      !terminal.has(result.operation.phase) &&
      !['waiting-for-idle', 'staged'].includes(result.operation.phase)
    ) {
      result.operation.phase = ['activating', 'validating', 'rolling-back'].includes(
        result.operation.phase,
      )
        ? 'unknown-outcome'
        : 'interrupted';
    }
    return result;
  }
  private async persist() {
    this.assertOwned?.();
    this.state.history = this.state.history.slice(-100);
    while (Buffer.byteLength(JSON.stringify(this.state)) > 1024 * 1024 && this.state.history.length)
      this.state.history.shift();
    if (Buffer.byteLength(JSON.stringify(this.state)) > 1024 * 1024)
      throw new Error('Runtime operation history exceeds its size limit.');
    await writeJSON(join(this.options.root, 'installation.json'), this.state);
    this.options.changed?.();
  }
  private async phase(phase: UpdatePhase, error?: string) {
    const operation = this.state.operation!;
    operation.phase = phase;
    operation.sequence++;
    operation.updatedAt = this.now();
    operation.error = error;
    await this.persist();
  }
  /** Discover the newest release, and verify its signed metadata. This needs the network. */
  private async resolve(): Promise<SignedRuntimeRelease> {
    const discovered = await this.options.discover();
    if (!discovered) throw new Error('No runtime release supports this execution host.');
    return fetchRuntimeRelease(discovered, {
      now: Math.floor(this.now() / 1000),
      desktopVersion: this.options.desktopVersion,
      os: this.options.os,
      arch: this.options.arch,
      systemVersion: this.options.systemVersion,
      checkpoint: this.state.checkpoint || this.state.active?.checkpoint,
      key: this.options.key,
      request: this.options.request,
    });
  }
  private revoked() {
    return [...(this.state.revoked || []), ...(this.latest?.revoked || [])];
  }
  /**
   * Start an automatic update when a newer signed release is known and a version is installed.
   * The desktop app starts the first install at launch, in the background, and again at each
   * launch until it succeeds. An automatic update that failed, or that the user canceled, does
   * not start again for the same release. Install in Settings starts it again.
   */
  private autoUpdate() {
    if (this.installPending) return;
    const operation = this.state.operation;
    if (operation?.phase === 'waiting-for-idle') {
      if (!this.options.busy()) void this.install().catch(() => {});
      return;
    }
    const latest = this.view.latest;
    if (!latest || !this.state.active || this.state.active.release.sha256 === latest.sha256) return;
    if (
      operation &&
      operation.target.sha256 === latest.sha256 &&
      terminal.has(operation.phase) &&
      operation.phase !== 'completed'
    )
      return;
    void this.install().catch(() => {});
  }
  check(force = false) {
    if (this.checkPending) return this.checkPending;
    if (
      !force &&
      this.view.lastSuccessAt !== undefined &&
      this.now() - this.view.lastSuccessAt < 6 * 3600000
    ) {
      // A staged update activates when the managed runs stop. Status reads check for this.
      this.autoUpdate();
      return Promise.resolve(this.status());
    }
    const task = (async () => {
      this.view.discovery = 'checking';
      this.view.lastAttemptAt = this.now();
      let discovering = false;
      try {
        await this.prepare();
        if (!this.installPending) await this.readState();
        discovering = true;
        const release = await this.resolve();
        const target = releaseIdentity(release);
        this.latest = release;
        this.view.latest = target;
        this.view.discovery =
          this.state.active?.release.sha256 === target.sha256 ? 'current' : 'available';
        this.view.lastSuccessAt = this.now();
        this.view.stale = false;
        this.view.error = undefined;
      } catch (error) {
        // A network failure is 'failed'. A signature, digest, or rollback failure is 'blocked'.
        this.view.discovery = discovering && !verificationError(error) ? 'failed' : 'blocked';
        this.view.stale = true;
        this.view.error = safeInstallError(error);
      }
      this.options.changed?.();
      this.autoUpdate();
      return this.status();
    })();
    this.checkPending = task;
    void task.finally(() => {
      if (this.checkPending === task) this.checkPending = undefined;
    });
    return task;
  }
  install() {
    if (this.installPending) return this.installPending;
    this.installRunning = true;
    const task = this.performInstall();
    this.installPending = task;
    void task.finally(() => {
      if (this.installPending === task) this.installPending = undefined;
    });
    return task;
  }
  /**
   * Verify the signed files of a release that the desktop wants to copy to this host. This uses
   * no network. It applies the checkpoint of this host, so an older release cannot replace it.
   */
  async verifyTransfer(discovered: RuntimeDiscovery, files: ReleaseFiles) {
    await this.prepare();
    if (!this.installPending) await this.readState();
    if (this.installPending)
      throw new Error('An install or check is in progress. Wait for it to finish.');
    return verifyReleaseFiles(discovered, files, {
      now: Math.floor(this.now() / 1000),
      desktopVersion: this.options.desktopVersion,
      os: this.options.os,
      arch: this.options.arch,
      systemVersion: this.options.systemVersion,
      checkpoint: this.state.checkpoint || this.state.active?.checkpoint,
      key: this.options.key,
    });
  }
  /**
   * Install a release that the desktop copied to this host. The host verifies the signed files and
   * the archive again. It does not trust the verification of the desktop.
   */
  installTransferred(source: TransferredRuntime) {
    if (this.installPending)
      return Promise.reject(
        new Error('An install or check is in progress. Wait for it to finish.'),
      );
    this.installRunning = true;
    const task = this.performInstall(source);
    this.installPending = task;
    void task.finally(() => {
      if (this.installPending === task) this.installPending = undefined;
    });
    return task;
  }
  async start() {
    await this.check();
    // Installation outlives the IPC request. Reconnect reads its host-side journal.
    void this.install().catch(() => {});
    return this.status();
  }
  private async performInstall(source?: TransferredRuntime) {
    let transferred: ComponentRelease | undefined;
    try {
      await this.prepare();
      await withDirectoryLock(this.options.root, async (assertOwned) => {
        this.assertOwned = assertOwned;
        await this.readState(true);
        const release = source
          ? verifyReleaseFiles(source.discovered, source.files, {
              now: Math.floor(this.now() / 1000),
              desktopVersion: this.options.desktopVersion,
              os: this.options.os,
              arch: this.options.arch,
              systemVersion: this.options.systemVersion,
              checkpoint: this.state.checkpoint || this.state.active?.checkpoint,
              key: this.options.key,
            })
          : await this.resolve();
        this.latest = release;
        const target = releaseIdentity(release);
        if (source) transferred = target;
        this.state.checkpoint = release.checkpoint;
        this.state.revoked = release.revoked;
        if (this.state.active?.release.sha256 === target.sha256) {
          try {
            const executable = await this.verifyReceipt(this.state.active);
            await this.options.probe(executable, this.state.active.release.version);
            if (this.state.operation && !terminal.has(this.state.operation.phase)) {
              this.state.staged = undefined;
              await this.phase('completed');
            } else await this.persist();
          } catch (error) {
            if (!this.state.operation || terminal.has(this.state.operation.phase)) throw error;
            await this.rollback();
          }
          return;
        }
        if (this.state.operation?.phase === 'rolling-back') {
          await this.rollback();
          return;
        }
        const resume =
          this.state.operation &&
          !terminal.has(this.state.operation.phase) &&
          this.state.operation.target.sha256 === target.sha256;
        if (this.state.operation && !resume) {
          if (!terminal.has(this.state.operation.phase))
            this.state.operation = {
              ...this.state.operation,
              phase: 'interrupted',
              updatedAt: this.now(),
            };
          this.state.history.push(this.state.operation);
        }
        if (!resume)
          this.state.operation = {
            id: randomUUID(),
            hostId: this.options.hostId,
            component: 'verdictan',
            generation: (this.state.operation?.generation || 0) + 1,
            sequence: 1,
            phase: 'requested',
            target,
            previous: this.state.active?.release,
            receivedBytes: 0,
            totalBytes: release.artifact.size,
            startedAt: this.now(),
            updatedAt: this.now(),
          };
        await this.persist();
        const abort = new AbortController();
        this.abort = abort;
        const timeout = setTimeout(() => abort.abort(new Error('Download timed out.')), 120000);
        timeout.unref?.();
        let staging: string | undefined;
        try {
          if (this.state.staged?.release.sha256 !== target.sha256) {
            staging = await mkdtemp(join(this.options.root, '.install-'));
            const archive = join(staging, 'runtime.archive');
            const payload = join(staging, 'payload');
            await mkdir(payload, { mode: 0o700 });
            if (source) {
              // The copy is complete. Check its size and digest, then its signature below.
              await rename(source.archive, archive);
              this.state.operation!.receivedBytes = release.artifact.size;
              await verifyRuntimeArchive(release.artifact, archive);
            } else {
              await this.phase('downloading');
              let notified = 0;
              await downloadRuntime(
                release.artifact,
                archive,
                releaseDownloadOrigins,
                abort.signal,
                (bytes) => {
                  this.state.operation!.receivedBytes = bytes;
                  if (bytes - notified >= 1024 * 1024) {
                    notified = bytes;
                    this.options.changed?.();
                  }
                },
                this.options.request,
              );
            }
            await this.phase('verifying');
            await verifySignedFile(
              archive,
              release.archiveSignature,
              this.options.key ?? releasePublicKey(),
            );
            const executable = await extractRuntime(archive, payload, release.artifact);
            abort.signal.throwIfAborted();
            await this.options.probe(executable, release.version);
            const receipt: Receipt = {
              schema: 1,
              release: target,
              executable: release.artifact.os === 'win32' ? 'verdictan.exe' : 'verdictan',
              binaryDigest: await fileDigest(executable),
              checkpoint: release.checkpoint,
            };
            await writeFile(join(payload, '.verdictan-managed-install'), 'Kalkidan\n', {
              flag: 'wx',
              mode: 0o600,
            });
            const destination = join(this.options.root, 'versions', target.sha256);
            assertOwned();
            try {
              await rename(payload, destination);
            } catch (error: any) {
              if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
              await this.verifyReceipt(receipt);
            }
            this.state.staged = receipt;
            await this.phase('staged');
          }
          clearTimeout(timeout);
          abort.signal.throwIfAborted();
          if (this.options.busy()) {
            await this.phase('waiting-for-idle');
            return;
          }
          await this.options.beforeActivate?.();
          const staged = this.state.staged!;
          await this.verifyReceipt(staged);
          assertOwned();
          await this.phase('activating');
          const old = this.state.active;
          this.state.previous = old;
          this.state.active = staged;
          await this.phase('validating');
          try {
            await this.options.probe(await this.verifyReceipt(staged), staged.release.version);
            assertOwned();
            this.state.staged = undefined;
            await this.phase('completed');
          } catch (error) {
            await this.rollback(error);
          }
        } catch (error) {
          await this.phase(
            this.state.operation?.phase === 'rolling-back'
              ? 'rollback-failed'
              : abort.signal.aborted
                ? 'canceled'
                : 'failed',
            safeInstallError(error),
          );
        } finally {
          clearTimeout(timeout);
          this.abort = undefined;
          if (staging) await rm(staging, { recursive: true, force: true });
        }
      });
    } catch (error) {
      this.view.error = safeInstallError(error);
      this.view.stale = true;
    } finally {
      this.assertOwned = undefined;
      this.installRunning = false;
      if (source) await rm(source.archive, { force: true });
    }
    if (transferred) {
      // This host cannot reach the release server, so the copied release is the newest known.
      this.view = {
        ...this.view,
        latest: transferred,
        discovery:
          this.state.active?.release.sha256 === transferred.sha256 ? 'current' : 'available',
        lastAttemptAt: this.now(),
        lastSuccessAt: this.now(),
        stale: false,
        error: undefined,
      };
      this.options.changed?.();
      return this.status();
    }
    await this.check(true);
    return this.status();
  }
  /** `cause` is the failure of the new version. A refused keychain prompt keeps its own words. */
  private async rollback(cause?: unknown) {
    await this.phase('rolling-back');
    this.state.active = undefined;
    await this.persist();
    try {
      const old = this.state.previous;
      if (!old) throw new Error('No previous runtime is available for recovery.');
      assertNotRevoked(old, this.revoked());
      await this.options.probe(await this.verifyReceipt(old), old.release.version);
      this.assertOwned?.();
      this.state.active = old;
      await this.phase(
        'rolled-back',
        keychainRefused(cause)
          ? keychainRollbackError
          : 'Runtime activation failed. The previous installation was restored.',
      );
    } catch (error) {
      await this.phase('rollback-failed', safeInstallError(error));
    }
  }
  async cancel() {
    const phase = this.state.operation?.phase;
    if (phase && ['activating', 'validating', 'rolling-back'].includes(phase))
      throw new Error('Wait for activation or recovery to finish.');
    this.abort?.abort();
    if (this.installPending) return this.installPending;
    if (phase === 'waiting-for-idle' || phase === 'staged') {
      await withDirectoryLock(this.options.root, async (assertOwned) => {
        this.assertOwned = assertOwned;
        try {
          await this.readState();
          if (
            this.state.operation &&
            ['waiting-for-idle', 'staged'].includes(this.state.operation.phase)
          )
            await this.phase('canceled');
        } finally {
          this.assertOwned = undefined;
        }
      });
    }
    return this.status();
  }
  private async verifyReceipt(receipt: Receipt) {
    if (
      !validReceipt(receipt) ||
      (receipt.executable === 'verdictan.exe') !== (this.options.os === 'win32')
    )
      throw new Error('Invalid runtime receipt.');
    const directory = join(this.options.root, 'versions', receipt.release.sha256);
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('The runtime directory is not a regular directory.');
    const file = join(directory, receipt.executable);
    if ((await fileDigest(file)) !== receipt.binaryDigest)
      throw new Error('The installed runtime checksum failed. Install the runtime again.');
    return file;
  }
  async executable() {
    await this.prepare();
    if (!this.installPending) await this.readState();
    if (!this.state.active) return null;
    // This check uses no network. The revoked versions come from the newest verified manifest.
    assertNotRevoked(this.state.active, this.revoked());
    return this.verifyReceipt(this.state.active);
  }
}
function assertNotRevoked(receipt: Receipt, revoked: string[]) {
  if (revoked.includes(receipt.release.version))
    throw new Error('The installed runtime has been revoked. Install the newest release.');
}
function verificationError(error: unknown) {
  return (
    error instanceof Error &&
    /^(?:Release |Runtime artifact |This |Invalid |Update |Cannot |The release is )/.test(
      error.message,
    )
  );
}
function releaseIdentity(release: VerifiedRuntimeRelease): ComponentRelease {
  return {
    version: release.version,
    releaseId: `${release.checkpoint.sequence}:${release.checkpoint.digest}`,
    sha256: release.artifact.sha256,
  };
}
function validReceipt(value: Receipt) {
  return (
    value.schema === 1 &&
    ['verdictan', 'verdictan.exe'].includes(value.executable) &&
    /^[a-f0-9]{64}$/.test(value.binaryDigest) &&
    /^[a-f0-9]{64}$/.test(value.release?.sha256) &&
    typeof value.release.version === 'string' &&
    typeof value.release.releaseId === 'string' &&
    validCheckpoint(value.checkpoint)
  );
}
function validCheckpoint(value: ReleaseCheckpoint) {
  return (
    value &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    /^[a-f0-9]{64}$/.test(value.digest)
  );
}
function publicOperation(value: UpdateOperation, hostId: string): UpdateOperation {
  const phases: UpdatePhase[] = [
    'requested',
    'downloading',
    'verifying',
    'staged',
    'waiting-for-idle',
    'activating',
    'validating',
    'completed',
    'canceled',
    'failed',
    'interrupted',
    'unknown-outcome',
    'rolling-back',
    'rolled-back',
    'rollback-failed',
  ];
  const validRelease = (release: ComponentRelease) =>
    release &&
    /^\d+\.\d+\.\d+$/.test(release.version) &&
    /^[a-f0-9]{64}$/.test(release.sha256) &&
    typeof release.releaseId === 'string' &&
    release.releaseId.length <= 200;
  if (
    !value ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(value.id) ||
    value.hostId !== hostId ||
    value.component !== 'verdictan' ||
    !phases.includes(value.phase) ||
    !validRelease(value.target) ||
    (value.previous !== undefined && !validRelease(value.previous)) ||
    ![
      value.generation,
      value.sequence,
      value.receivedBytes,
      value.totalBytes,
      value.startedAt,
      value.updatedAt,
    ].every((number) => Number.isSafeInteger(number) && number >= 0) ||
    value.receivedBytes > value.totalBytes
  )
    throw new Error('Invalid runtime operation history.');
  const project = (release: ComponentRelease): ComponentRelease => ({
    version: release.version,
    releaseId: release.releaseId,
    sha256: release.sha256,
  });
  return {
    id: value.id,
    generation: value.generation,
    sequence: value.sequence,
    hostId,
    component: 'verdictan',
    phase: value.phase,
    target: project(value.target),
    previous: value.previous && project(value.previous),
    receivedBytes: value.receivedBytes,
    totalBytes: value.totalBytes,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    error: typeof value.error === 'string' ? safeInstallError(new Error(value.error)) : undefined,
  };
}
async function fileDigest(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024)
      throw new Error('Invalid runtime executable.');
    const hash = createHash('sha256');
    for await (const bytes of file.createReadStream({ autoClose: false })) hash.update(bytes);
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}
/** True when the system keychain refused the runtime, for example after a refused prompt. */
function keychainRefused(error: unknown) {
  return error instanceof Error && error.message === managedErrorText(keychainRefusedCode);
}
/** Retry in Settings › Computers starts the install again, and the system asks again. */
const keychainInstallError =
  'The new runtime did not get access to the system keychain. Select Retry, then allow access when the system asks.';
const keychainRollbackError =
  'The new runtime did not get access to the system keychain. The previous version was restored. Select Retry, then allow access when the system asks.';
function safeInstallError(error: unknown) {
  if (keychainRefused(error)) return keychainInstallError;
  if (
    error instanceof Error &&
    /^(?:The |This |Runtime |Release |Invalid |No |Update |Storage |Cannot )/.test(error.message)
  )
    return error.message.slice(0, 300);
  return 'Runtime installation failed. Check available storage and retry.';
}
