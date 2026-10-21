import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withDirectoryLock } from '../storage/directory-lock';
import { writeJSON } from '../storage/atomic-json';
import type {
  ComponentRelease,
  ComponentUpdateStatus,
  UpdateOperation,
  UpdatePhase,
} from '../../src/domain/updates';
import {
  verifyRuntimeRelease,
  type RuntimePin,
  type VerifiedRuntimeRelease,
  type ReleaseCheckpoint,
} from './release';
import { downloadRuntime } from './download';
import { extractRuntime } from './archive';

export interface RuntimePolicy {
  manifest: string;
  pin: RuntimePin;
  hostPolicies?: Record<string, RuntimePolicy>;
  pins?: Record<string, RuntimePin>;
  downloadOrigins: string[];
}
export function runtimePolicyForHost(
  policy: RuntimePolicy,
  os: string,
  arch: string,
): RuntimePolicy {
  const key = `${os}-${arch}`;
  if (policy.hostPolicies && Object.hasOwn(policy.hostPolicies, key)) {
    const selected = policy.hostPolicies[key];
    if (!selected || selected.hostPolicies) throw new Error('Invalid host runtime policy.');
    return runtimePolicyForHost(selected, os, arch);
  }
  if (!policy.pins) return policy;
  if (
    typeof policy.pins !== 'object' ||
    Array.isArray(policy.pins) ||
    Object.keys(policy.pins).length > 5 ||
    !Object.hasOwn(policy.pins, key)
  )
    throw new Error('No reviewed Verdictan artifact is available for this host.');
  return { ...policy, pin: policy.pins[key] };
}
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
}
export interface RuntimeInstallerOptions {
  root: string;
  hostId: string;
  desktopVersion: string;
  os: string;
  arch: string;
  systemVersion: string;
  policy(): Promise<RuntimePolicy | null>;
  busy(): boolean;
  discover?(): Promise<ComponentRelease | undefined>;
  probe(executable: string, version: string): Promise<void>;
  beforeActivate?(): Promise<void>;
  changed?(): void;
  now?: () => number;
  request?: typeof fetch;
}
const terminal = new Set<UpdatePhase>([
  'completed',
  'failed',
  'canceled',
  'rolled-back',
  'rollback-failed',
]);
/** Installs only a reviewed artifact. The journal is authoritative on its execution host. */
export class RuntimeInstaller {
  private state: InstallationState = { schema: 1, history: [] };
  private view: ComponentUpdateStatus;
  private checkPending?: Promise<ComponentUpdateStatus>;
  private installPending?: Promise<ComponentUpdateStatus>;
  // True from the install request until the journal has its final state. The status that the
  // install returns is then already free of it.
  private installRunning = false;
  private abort?: AbortController;
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
    const current = !!result.approved && result.installed?.sha256 === result.approved.sha256;
    result.canInstallApproved = !!result.approved && !current && !busy;
    result.reason = result.canInstallApproved
      ? undefined
      : !result.approved
        ? result.error || 'No approved version is known yet. Check for updates.'
        : current
          ? `Version ${result.approved.version} is installed.`
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
  private async approved(): Promise<{ policy: RuntimePolicy; release: VerifiedRuntimeRelease }> {
    const configured = await this.options.policy();
    if (!configured)
      throw new Error('No reviewed Verdictan release is included with this Kalkidan build.');
    const policy = runtimePolicyForHost(configured, this.options.os, this.options.arch);
    if (
      typeof policy.manifest !== 'string' ||
      !Array.isArray(policy.downloadOrigins) ||
      !policy.downloadOrigins.length ||
      policy.downloadOrigins.length > 10 ||
      policy.downloadOrigins.some((origin) => {
        try {
          const url = new URL(origin);
          return url.protocol !== 'https:' || url.origin !== origin;
        } catch {
          return true;
        }
      })
    )
      throw new Error('Invalid approved runtime download origins.');
    const release = verifyRuntimeRelease(Buffer.from(policy.manifest), policy.pin, {
      now: Math.floor(this.now() / 1000),
      desktopVersion: this.options.desktopVersion,
      os: this.options.os,
      arch: this.options.arch,
      systemVersion: this.options.systemVersion,
      checkpoint: this.state.checkpoint || this.state.active?.checkpoint,
    });
    return { policy, release };
  }
  check(force = false) {
    if (this.checkPending) return this.checkPending;
    if (
      !force &&
      this.view.lastSuccessAt !== undefined &&
      this.now() - this.view.lastSuccessAt < 6 * 3600000
    )
      return Promise.resolve(this.status());
    const task = (async () => {
      this.view.discovery = 'checking';
      this.view.lastAttemptAt = this.now();
      let discovering = false;
      try {
        await this.prepare();
        if (!this.installPending) await this.readState();
        const { release } = await this.approved();
        const target = releaseIdentity(release);
        this.view.approved = target;
        discovering = true;
        const discovered = this.options.discover ? await this.options.discover() : target;
        this.view.discovered = discovered;
        this.view.discovery =
          this.state.active?.release.sha256 === target.sha256 ? 'current' : 'available';
        // A newer release that is not approved is information. The approved one stays installable.
        this.view.notice =
          discovered && discovered.sha256 !== target.sha256
            ? `Version ${discovered.version} is available. It is not approved for this version of Kalkidan yet.`
            : undefined;
        this.view.lastSuccessAt = this.now();
        this.view.stale = false;
        this.view.error = undefined;
      } catch (error) {
        this.view.discovery = discovering ? 'failed' : 'blocked';
        this.view.stale = true;
        this.view.error = safeInstallError(error);
      }
      this.options.changed?.();
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
  async start() {
    await this.check();
    // Installation outlives the IPC request. Reconnect reads its host-side journal.
    void this.install().catch(() => {});
    return this.status();
  }
  private async performInstall() {
    try {
      await this.prepare();
      await withDirectoryLock(this.options.root, async (assertOwned) => {
        this.assertOwned = assertOwned;
        await this.readState(true);
        const { policy, release } = await this.approved();
        const target = releaseIdentity(release);
        this.state.checkpoint = release.checkpoint;
        if (this.state.active?.release.sha256 === target.sha256) {
          try {
            const executable = await this.verifyReceipt(this.state.active);
            await this.options.probe(executable, this.state.active.release.version);
            if (this.state.operation && !terminal.has(this.state.operation.phase)) {
              this.state.staged = undefined;
              await this.phase('completed');
            }
          } catch (error) {
            if (!this.state.operation || terminal.has(this.state.operation.phase)) throw error;
            await this.rollback(policy);
          }
          return;
        }
        if (this.state.operation?.phase === 'rolling-back') {
          await this.rollback(policy);
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
            await this.phase('downloading');
            let notified = 0;
            await downloadRuntime(
              release.artifact,
              archive,
              policy.downloadOrigins,
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
            await this.phase('verifying');
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
          const approved = await this.approved();
          if (releaseIdentity(approved.release).releaseId !== target.releaseId)
            throw new Error('Release approval changed. Check for updates and retry.');
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
          } catch {
            await this.rollback(policy);
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
    }
    await this.check(true);
    return this.status();
  }
  private async rollback(policy: RuntimePolicy) {
    await this.phase('rolling-back');
    this.state.active = undefined;
    await this.persist();
    try {
      const old = this.state.previous;
      if (!old) throw new Error('No previous runtime is available for recovery.');
      assertNotRevoked(old, policy);
      await this.options.probe(await this.verifyReceipt(old), old.release.version);
      this.assertOwned?.();
      this.state.active = old;
      await this.phase(
        'rolled-back',
        'Runtime activation failed. The previous installation was restored.',
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
      throw new Error('The installed runtime checksum failed. Reinstall the approved release.');
    return file;
  }
  async executable() {
    await this.prepare();
    if (!this.installPending) await this.readState();
    if (!this.state.active) return null;
    const { policy } = await this.approved();
    assertNotRevoked(this.state.active, policy);
    return this.verifyReceipt(this.state.active);
  }
}
function assertNotRevoked(receipt: Receipt, policy: RuntimePolicy) {
  const manifest = JSON.parse(policy.manifest);
  if (
    [...policy.pin.revoked_versions, ...manifest.revoked_versions].includes(receipt.release.version)
  )
    throw new Error('The installed runtime has been revoked. Install an approved release.');
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
function safeInstallError(error: unknown) {
  if (
    error instanceof Error &&
    /^(?:The |Runtime |Release |Invalid |No |Update |Storage )/.test(error.message)
  )
    return error.message.slice(0, 300);
  return 'Runtime installation failed. Check available storage and retry.';
}
export async function readRuntimePolicy(path: string): Promise<RuntimePolicy | null> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 512 * 1024)
        throw new Error('Release configuration exceeds its size limit.');
      return JSON.parse(await file.readFile('utf8'));
    } finally {
      await file.close();
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
