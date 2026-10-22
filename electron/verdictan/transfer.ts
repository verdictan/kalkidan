import { randomUUID, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentUpdateStatus, RuntimeTransferProgress } from '../../src/domain/updates';
import { discoverRuntime } from '../updates/runtime-feed';
import { downloadRuntime } from './download';
import type { RuntimeInstaller } from './install';
import { releaseDownloadOrigins, type RuntimeDiscovery } from './release';
import { fetchRuntimeRelease, releaseFileLimits, type ReleaseFiles } from './release-source';
import { releasePublicKey, verifySignedFile } from './signature';

/**
 * The bytes in one copy request. Base64 makes a line of about 1.4 MB. The helper accepts lines
 * up to 16 MB.
 */
export const transferChunkBytes = 1024 * 1024;
/** A copy that gets no data for this time stops, and the host deletes the partial file. */
export const transferIdleMs = 5 * 60000;

const encode = (files: ReleaseFiles) => ({
  manifest: files.manifest.toString('base64'),
  manifestSignature: files.manifestSignature.toString('base64'),
  archiveSignature: files.archiveSignature.toString('base64'),
});
function decodeBase64(value: unknown, limit: number) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4)
    throw new Error('Invalid runtime copy request.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('Invalid runtime copy request.');
  return bytes;
}
function decodeDiscovery(value: any): RuntimeDiscovery {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.version !== 'string' ||
    typeof value.releaseId !== 'string' ||
    value.releaseId.length > 200 ||
    typeof value.sha256 !== 'string' ||
    !Number.isSafeInteger(value.size)
  )
    throw new Error('Invalid runtime copy request.');
  return {
    version: value.version,
    releaseId: value.releaseId,
    sha256: value.sha256,
    size: value.size,
  };
}

/** The execution host of a copy, from its `hello` reply. */
export interface TransferHost {
  platform: string;
  arch: string;
  systemVersion: string;
}

/**
 * Download a release on the desktop, verify its signed manifest, its checksum, and its signature,
 * and copy it to an SSH host over the existing SSH connection. The host verifies all of it again
 * before it installs. Kalkidan copies only a release that the Verdictan release key signs.
 */
export async function transferRuntime(options: {
  host: TransferHost;
  desktopVersion: string;
  /** Sends one `runtime-transfer` request to the host helper. */
  call(operation: 'begin' | 'chunk' | 'commit' | 'abort', args: unknown[]): Promise<any>;
  /** A private folder for the download on the desktop. */
  directory: string;
  request?: typeof fetch;
  /** Find the newest release for the host. Only tests replace it. */
  discover?: () => Promise<RuntimeDiscovery | undefined>;
  now?: () => number;
  key?: KeyObject;
  signal?: AbortSignal;
  /** Called at each step, and as bytes move in the download and in the copy. */
  progress?(update: RuntimeTransferProgress): void;
}): Promise<ComponentUpdateStatus> {
  const { host } = options;
  const request = options.request ?? fetch;
  const discovered = await (
    options.discover ?? (() => discoverRuntime(host.platform, host.arch, request))
  )();
  if (!discovered) throw new Error('No runtime release supports this execution host.');
  const key = options.key ?? releasePublicKey();
  const release = await fetchRuntimeRelease(discovered, {
    now: Math.floor((options.now ?? Date.now)() / 1000),
    desktopVersion: options.desktopVersion,
    os: host.platform,
    arch: host.arch,
    systemVersion: host.systemVersion,
    key,
    request,
  });
  const signal = options.signal ?? AbortSignal.timeout(30 * 60000);
  const totalBytes = release.artifact.size;
  const report = (phase: RuntimeTransferProgress['phase'], bytes: number) =>
    options.progress?.({ phase, bytes, totalBytes });
  const folder = await mkdtemp(join(options.directory, 'kalkidan-runtime-copy-'));
  let id: string | undefined;
  try {
    const archive = join(folder, 'runtime.archive');
    // The download checks the size and the SHA-256 digest. The signature check comes next.
    await downloadRuntime(
      release.artifact,
      archive,
      releaseDownloadOrigins,
      signal,
      (bytes) => report('downloading', bytes),
      request,
    );
    report('verifying', totalBytes);
    await verifySignedFile(archive, release.archiveSignature, key);
    report('copying', 0);
    const begin = await options.call('begin', [discovered, encode(release.files)]);
    id = typeof begin?.id === 'string' ? begin.id : undefined;
    const chunkBytes = begin?.chunkBytes;
    if (
      !id ||
      !Number.isSafeInteger(chunkBytes) ||
      chunkBytes < 1 ||
      chunkBytes > transferChunkBytes
    )
      throw new Error('The host did not accept the runtime copy. Update the Kalkidan helper.');
    let offset = 0;
    for await (const chunk of createReadStream(archive, { highWaterMark: chunkBytes })) {
      signal.throwIfAborted();
      await options.call('chunk', [id, offset, (chunk as Buffer).toString('base64')]);
      offset += chunk.length;
      report('copying', offset);
    }
    report('installing', totalBytes);
    const status = await options.call('commit', [id]);
    id = undefined;
    return status;
  } finally {
    if (id) await options.call('abort', [id]).catch(() => {});
    await rm(folder, { recursive: true, force: true });
  }
}

interface Incoming {
  id: string;
  file: string;
  handle: FileHandle;
  received: number;
  discovered: RuntimeDiscovery;
  files: ReleaseFiles;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Receives a runtime copy on an SSH host. Only one copy runs at a time. The host verifies the
 * signed files before it accepts data, and the archive again before it installs.
 */
export class RuntimeTransferReceiver {
  private current?: Incoming;
  constructor(
    private root: string,
    private installer: () => RuntimeInstaller,
    private idleMs = transferIdleMs,
  ) {}
  async begin(discoveredValue: unknown, filesValue: any) {
    const discovered = decodeDiscovery(discoveredValue);
    const files: ReleaseFiles = {
      manifest: decodeBase64(filesValue?.manifest, releaseFileLimits.manifest),
      manifestSignature: decodeBase64(
        filesValue?.manifestSignature,
        releaseFileLimits.manifestSignature,
      ),
      archiveSignature: decodeBase64(
        filesValue?.archiveSignature,
        releaseFileLimits.archiveSignature,
      ),
    };
    // Fail before any data moves when the signature or the release is not valid for this host.
    const release = await this.installer().verifyTransfer(discovered, files);
    if (release.artifact.size !== discovered.size || release.artifact.sha256 !== discovered.sha256)
      throw new Error('Runtime artifact does not match the published release.');
    await this.abort();
    const id = randomUUID();
    const file = join(this.root, `.transfer-${id}`);
    const handle = await open(file, 'wx', 0o600);
    this.current = { id, file, handle, received: 0, discovered, files, timer: this.idle(id) };
    return { id, chunkBytes: transferChunkBytes };
  }
  private idle(id: string) {
    const timer = setTimeout(() => void this.abort(id), this.idleMs);
    timer.unref?.();
    return timer;
  }
  private take(id: unknown) {
    const current = this.current;
    if (!current || current.id !== id)
      throw new Error('The runtime copy stopped. Start the copy again.');
    return current;
  }
  async chunk(id: unknown, offset: unknown, data: unknown) {
    const current = this.take(id);
    const bytes = decodeBase64(data, transferChunkBytes);
    if (
      offset !== current.received ||
      !bytes.length ||
      current.received + bytes.length > current.discovered.size
    ) {
      await this.abort();
      throw new Error('The runtime copy is out of order. Start the copy again.');
    }
    clearTimeout(current.timer);
    current.timer = this.idle(current.id);
    let written = 0;
    while (written < bytes.length) {
      const { bytesWritten } = await current.handle.write(bytes, written, bytes.length - written);
      if (!bytesWritten) throw new Error('The runtime copy could not be written.');
      written += bytesWritten;
    }
    current.received += bytes.length;
    return { received: current.received };
  }
  async commit(id: unknown): Promise<ComponentUpdateStatus> {
    const current = this.take(id);
    if (current.received !== current.discovered.size) {
      await this.abort();
      throw new Error('The runtime copy is incomplete. Start the copy again.');
    }
    clearTimeout(current.timer);
    this.current = undefined;
    await current.handle.sync();
    await current.handle.close();
    const installer = this.installer();
    // The install continues after this reply. Status reads show its progress.
    void installer
      .installTransferred({
        discovered: current.discovered,
        files: current.files,
        archive: current.file,
      })
      .catch(() => rm(current.file, { force: true }));
    return installer.status();
  }
  async abort(id?: unknown) {
    const current = this.current;
    if (!current || (id !== undefined && current.id !== id)) return false;
    this.current = undefined;
    clearTimeout(current.timer);
    await current.handle.close().catch(() => {});
    await rm(current.file, { force: true });
    return true;
  }
}
