import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DesktopUpdateProgress, DesktopUpdateStatus } from '../../src/domain/updates';
import { writeJSON } from '../storage/atomic-json';
import {
  applyStagedUpdate,
  detectInstallation,
  stageMacApp,
  type ApplyOptions,
  type DesktopInstallation,
} from './desktop-install';

/** Where releases are listed and downloaded. Each download must stay on these origins. */
export interface ReleaseOrigin {
  api: string;
  download: string;
  page: string;
  origins: string[];
}
export const githubReleaseOrigin: ReleaseOrigin = {
  api: 'https://api.github.com/repos/verdictan/packages/releases',
  download: 'https://github.com/verdictan/packages/releases/download/',
  page: 'https://github.com/verdictan/packages/releases/tag/',
  origins: [
    'https://github.com',
    'https://objects.githubusercontent.com',
    'https://release-assets.githubusercontent.com',
    'https://github-releases.githubusercontent.com',
  ],
};
/**
 * The release origin. `KALKIDAN_DESKTOP_RELEASE_FEED` can point to a loopback test server only.
 * Any other value keeps the published GitHub releases.
 */
export function releaseOrigin(value = process.env.KALKIDAN_DESKTOP_RELEASE_FEED): ReleaseOrigin {
  if (!value) return githubReleaseOrigin;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password
    )
      return githubReleaseOrigin;
    const root = url.origin + url.pathname.replace(/\/+$/, '');
    return {
      api: `${root}/releases`,
      download: `${root}/download/`,
      page: `${root}/tag/`,
      origins: [url.origin],
    };
  } catch {
    return githubReleaseOrigin;
  }
}

export type ReleaseFeed = (page: number, signal: AbortSignal) => Promise<unknown>;
export function releaseFeed(origin: ReleaseOrigin, request: typeof fetch = fetch): ReleaseFeed {
  return async (page, signal) => {
    const response = await request(`${origin.api}?per_page=100&page=${page}`, {
      signal,
      redirect: 'error',
      headers: { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
    });
    if (!response.ok || !response.body) throw new Error('Release discovery is unavailable.');
    return JSON.parse((await readLimited(response, 4 * 1024 * 1024)).toString('utf8'));
  };
}
export const desktopReleaseFeed = releaseFeed(githubReleaseOrigin);

async function readLimited(response: Response, limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body!) {
    size += chunk.byteLength;
    if (size > limit) throw new Error('Release metadata exceeds its size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
/** Text that the user can read. Other errors show a general message. */
class UpdateError extends Error {}
const generalFailure = 'The update did not finish. Check your connection, then try again.';
/** The largest installer that Kalkidan downloads. */
const assetLimit = 1024 * 1024 * 1024;

/** One downloadable release asset and the published checksum list for its release. */
interface Candidate {
  version: string;
  name: string;
  url: string;
  sums: string;
  size: number;
  sha256: string;
}
interface StagedRecord {
  version: string;
  name: string;
  sha256: string;
  kind: DesktopInstallation['kind'];
  staged: string;
}
export async function sha256File(path: string) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
/** Reads `SHA256SUMS.txt`: one `<sha256>  <file name>` line for each release asset. */
export function parseChecksums(text: string) {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64}) [ *]([A-Za-z0-9][\w.+-]{0,200})$/.exec(line);
    if (!match || sums.has(match[2]))
      throw new UpdateError('The published checksum list is not valid.');
    sums.set(match[2], match[1]);
  }
  return sums;
}

export interface DesktopUpdateOptions {
  version: string;
  bundle: string;
  journal: string;
  platform: string;
  arch: string;
  feed?: ReleaseFeed;
  now?: () => number;
  changed?(): void;
  /** The folder for downloads and staged releases. */
  root?: string;
  origin?: ReleaseOrigin;
  fetch?: typeof fetch;
  installation?: () => Promise<DesktopInstallation>;
  /** Process data for the installer step. */
  pid?: number;
  execPath?: string;
  quit?(): void;
  relaunch?(execPath: string): void;
  apply?(options: ApplyOptions): Promise<void>;
}

/**
 * Discovery, download, verification, and staging of desktop releases. Each step needs an
 * explicit user action: discovery never downloads, and a staged release never restarts the app.
 */
export class DesktopUpdates {
  private state: DesktopUpdateStatus;
  private pending?: Promise<DesktopUpdateStatus>;
  private initialized?: Promise<void>;
  private candidate?: Candidate;
  private staged?: StagedRecord;
  private task?: Promise<void>;
  private controller?: AbortController;
  private origin: ReleaseOrigin;
  private root: string;
  constructor(private options: DesktopUpdateOptions) {
    this.origin = options.origin || githubReleaseOrigin;
    this.root = options.root || join(options.journal, '..', 'desktop');
    this.state = {
      installedVersion: options.version,
      runningVersion: options.version,
      runningBuild: 'unknown',
      discovery: 'unknown',
      stale: true,
      install: { kind: 'unsupported', selfUpdate: false },
    };
  }
  private now() {
    return (this.options.now || Date.now)();
  }
  private snapshot() {
    return structuredClone(this.state);
  }
  private changed() {
    this.options.changed?.();
  }
  private installation() {
    return this.options.installation
      ? this.options.installation()
      : detectInstallation({
          platform: this.options.platform,
          arch: this.options.arch,
          execPath: this.options.execPath || process.execPath,
          packaged: true,
          env: process.env,
        });
  }
  private async refreshInstall() {
    const install = await this.installation();
    this.state.install = {
      kind: install.kind,
      selfUpdate: install.selfUpdate,
      ...(install.reason ? { reason: install.reason } : {}),
    };
    return install;
  }
  async status(force = false): Promise<DesktopUpdateStatus> {
    await this.initialize();
    if (this.pending) return structuredClone(await this.pending);
    if (
      !force &&
      this.state.lastSuccessAt &&
      this.now() - this.state.lastSuccessAt < 6 * 60 * 60 * 1000
    )
      return this.snapshot();
    const task = this.check();
    this.pending = task;
    try {
      return structuredClone(await task);
    } finally {
      if (this.pending === task) this.pending = undefined;
    }
  }
  private initialize() {
    return (this.initialized ??= this.load());
  }
  private async load() {
    this.state.runningBuild = await readFile(this.options.bundle)
      .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
      .catch(() => 'unknown');
    await this.refreshInstall().catch(() => {});
    try {
      const saved = JSON.parse(await readFile(this.options.journal, 'utf8'));
      if (saved.runningVersion === this.options.version && this.validRelease(saved.release)) {
        this.state.release = saved.release;
        if (Number.isFinite(saved.lastSuccessAt) && saved.lastSuccessAt <= this.now())
          this.state.lastSuccessAt = saved.lastSuccessAt;
        if (this.validCandidate(saved.candidate, saved.release)) this.candidate = saved.candidate;
        if (saved.discovery === 'available' || saved.discovery === 'current')
          this.state.discovery = saved.discovery;
      }
    } catch {
      /* A missing or damaged discovery cache must not block the app. */
    }
    await this.reconcile();
  }
  /** Reads the result of an earlier install and keeps a staged release for a later restart. */
  private async reconcile() {
    const resultFile = join(this.root, 'result.txt');
    const result = (await readFile(resultFile, 'utf8').catch(() => '')).trim();
    let staged: StagedRecord | undefined;
    try {
      staged = JSON.parse(await readFile(join(this.root, 'staged.json'), 'utf8'));
    } catch {
      staged = undefined;
    }
    const valid =
      !!staged &&
      typeof staged.version === 'string' &&
      typeof staged.name === 'string' &&
      typeof staged.staged === 'string' &&
      /^[a-f0-9]{64}$/.test(staged.sha256 || '');
    if (valid && staged!.version === this.options.version) {
      // The staged release is now running. Remove the download.
      await rm(this.root, { recursive: true, force: true }).catch(() => {});
      return;
    }
    if (valid && result && result !== 'installed') {
      await rm(this.root, { recursive: true, force: true }).catch(() => {});
      this.state.update = {
        phase: 'failed',
        version: staged!.version,
        receivedBytes: 0,
        totalBytes: 0,
        error:
          'Kalkidan could not replace the installed app. The previous version still runs. Install the download from the release page.',
      };
      return;
    }
    if (
      valid &&
      desktopReleaseIsNewer(staged!.version, this.options.version) &&
      (await access(staged!.staged).then(
        () => true,
        () => false,
      ))
    ) {
      this.staged = staged;
      this.state.update = {
        phase: 'staged',
        version: staged!.version,
        receivedBytes: 0,
        totalBytes: 0,
      };
      return;
    }
    await rm(this.root, { recursive: true, force: true }).catch(() => {});
  }
  private async check() {
    this.state = {
      ...this.state,
      discovery: 'checking',
      stale: true,
      lastAttemptAt: this.now(),
      error: undefined,
    };
    this.changed();
    try {
      const install = await this.refreshInstall();
      const platform = { darwin: 'mac', linux: 'linux', win32: 'win' }[this.options.platform];
      if (!platform || !['arm64', 'x64'].includes(this.options.arch)) {
        this.state.discovery = 'unsupported';
        return this.state;
      }
      const suffix =
        install.asset ||
        `${platform}-${this.options.arch}.${{ mac: 'dmg', linux: 'AppImage', win: 'exe' }[platform]}`;
      const signal = AbortSignal.timeout(30000);
      const feed = this.options.feed || releaseFeed(this.origin, this.options.fetch);
      let found = false;
      for (let page = 1; page <= 5 && !found; page++) {
        const response = await feed(page, signal);
        signal.throwIfAborted();
        if (!Array.isArray(response) || response.length > 100)
          throw new Error('Invalid release metadata.');
        for (const release of response) {
          if (
            release.draft ||
            release.prerelease ||
            typeof release.tag_name !== 'string' ||
            !release.tag_name.startsWith('kalkidan-v')
          )
            continue;
          const version = release.tag_name.slice('kalkidan-v'.length);
          if (!/^\d+\.\d+\.\d+(?:-build\.\d+\.[a-f0-9]{12})?$/.test(version)) continue;
          const name = `Kalkidan-${version}-${suffix}`;
          const assets = Array.isArray(release.assets) ? release.assets : [];
          const asset = assets.find((item: any) => item?.name === name);
          if (!asset) continue;
          const value = {
            version,
            id: String(release.id),
            url: release.html_url,
            sha256: typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '') : '',
            publishedAt: release.published_at,
            asset: name,
            ...(Number.isSafeInteger(asset.size) ? { size: asset.size } : {}),
          };
          if (!this.validRelease(value))
            throw new Error('Release identity or digest is incomplete.');
          const sums = assets.find((item: any) => item?.name === 'SHA256SUMS.txt');
          const candidate = {
            version,
            name,
            url: asset.browser_download_url,
            sums: sums?.browser_download_url,
            size: asset.size,
            sha256: value.sha256,
          };
          this.candidate = this.validCandidate(candidate, value) ? candidate : undefined;
          this.state.release = value;
          this.state.discovery = desktopReleaseIsNewer(version, this.state.runningVersion)
            ? 'available'
            : 'current';
          this.state.lastSuccessAt = this.now();
          this.state.stale = false;
          found = true;
          break;
        }
        if (response.length < 100) break;
      }
      if (!found) throw new Error('No compatible published desktop release was found.');
      await writeJSON(this.options.journal, { ...this.state, candidate: this.candidate });
    } catch {
      this.state.discovery = 'failed';
      this.state.stale = true;
      this.state.error =
        'Could not verify the release feed. The last known release is shown. Try again when online.';
    } finally {
      this.changed();
    }
    return this.state;
  }
  private validRelease(value: any): value is NonNullable<DesktopUpdateStatus['release']> {
    return (
      value &&
      typeof value.version === 'string' &&
      /^\d+$/.test(value.id) &&
      typeof value.url === 'string' &&
      value.url.startsWith(`${this.origin.page}kalkidan-v`) &&
      /^[\w.-]+$/.test(value.url.slice(this.origin.page.length)) &&
      typeof value.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.sha256) &&
      typeof value.publishedAt === 'string' &&
      Number.isFinite(Date.parse(value.publishedAt))
    );
  }
  /** A download must come from the release's own published path, with its size and checksum. */
  private validCandidate(value: any, release: any): value is Candidate {
    const prefix = `${this.origin.download}kalkidan-v${release?.version}/`;
    return (
      !!value &&
      value.version === release?.version &&
      value.sha256 === release?.sha256 &&
      typeof value.name === 'string' &&
      /^Kalkidan-[\w.+-]+$/.test(value.name) &&
      value.url === `${prefix}${value.name}` &&
      value.sums === `${prefix}SHA256SUMS.txt` &&
      Number.isSafeInteger(value.size) &&
      value.size > 0 &&
      value.size <= assetLimit
    );
  }
  private setUpdate(update: DesktopUpdateProgress | undefined) {
    this.state.update = update;
    this.changed();
  }
  /** Opens one release file. Redirects must stay on the release origins. */
  private async open(url: string, signal: AbortSignal) {
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      if (!this.origin.origins.includes(new URL(current).origin))
        throw new UpdateError('The release download left the trusted release server.');
      const response = await (this.options.fetch || fetch)(current, {
        signal,
        redirect: 'manual',
        headers: { accept: 'application/octet-stream' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) break;
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok || !response.body)
        throw new UpdateError('The release download is not available. Try again later.');
      return response;
    }
    throw new UpdateError('The release download is not available. Try again later.');
  }
  /** Starts the download. It returns at once; read the status for progress. */
  async download() {
    await this.initialize();
    if (this.task) return this.snapshot();
    const install = await this.refreshInstall();
    if (!install.selfUpdate)
      throw new Error(install.reason || 'This copy of Kalkidan cannot update itself.');
    if (this.state.update?.phase === 'staged' || this.state.update?.phase === 'restarting')
      return this.snapshot();
    const candidate = this.candidate;
    if (
      !candidate ||
      this.state.discovery !== 'available' ||
      candidate.version !== this.state.release?.version
    )
      throw new Error('No newer verified release is available. Check for updates first.');
    const controller = new AbortController();
    this.controller = controller;
    this.setUpdate({
      phase: 'downloading',
      version: candidate.version,
      receivedBytes: 0,
      totalBytes: candidate.size,
    });
    const task = this.fetchAndStage(candidate, install, controller.signal).catch(async (error) => {
      await rm(this.root, { recursive: true, force: true }).catch(() => {});
      this.staged = undefined;
      this.setUpdate({
        ...this.state.update!,
        phase: controller.signal.aborted ? 'canceled' : 'failed',
        error: controller.signal.aborted
          ? undefined
          : error instanceof UpdateError
            ? error.message
            : generalFailure,
      });
    });
    this.task = task.finally(() => {
      if (this.controller === controller) this.controller = undefined;
      this.task = undefined;
    });
    return this.snapshot();
  }
  /** Resolves when no download is active. */
  async settled() {
    await this.task;
    return this.snapshot();
  }
  async cancel() {
    this.controller?.abort();
    await this.task;
    return this.snapshot();
  }
  private async fetchAndStage(
    candidate: Candidate,
    install: DesktopInstallation,
    signal: AbortSignal,
  ) {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // The checksum list and the GitHub asset digest must agree before any download starts.
    const sums = parseChecksums(
      (await readLimited(await this.open(candidate.sums, signal), 64 * 1024)).toString('utf8'),
    );
    const expected = sums.get(candidate.name);
    if (!expected || expected !== candidate.sha256)
      throw new UpdateError(
        'The published checksums do not match the release. Kalkidan did not download it.',
      );
    const response = await this.open(candidate.url, signal);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 0 && length !== candidate.size)
      throw new UpdateError('The release download has an unexpected size. Try again later.');
    const file = join(this.root, candidate.name);
    const part = `${file}.part`;
    const hash = createHash('sha256');
    let received = 0;
    let reported = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.byteLength;
        if (received > candidate.size) {
          callback(new UpdateError('The download is larger than the published release.'));
          return;
        }
        hash.update(chunk);
        if (received - reported >= 256 * 1024 || received === candidate.size) {
          reported = received;
          this.setUpdate({ ...this.state.update!, receivedBytes: received });
        }
        callback(null, chunk);
      },
    });
    await pipeline(response.body!, meter, createWriteStream(part, { mode: 0o600 }), { signal });
    if (received !== candidate.size)
      throw new UpdateError('The download is not complete. Try again.');
    this.setUpdate({ ...this.state.update!, phase: 'verifying', receivedBytes: received });
    if (hash.digest('hex') !== expected)
      throw new UpdateError(
        'The download does not match the published SHA-256 checksum. Kalkidan deleted it.',
      );
    await rename(part, file);
    signal.throwIfAborted();
    this.setUpdate({ ...this.state.update!, phase: 'staging' });
    let staged = file;
    if (install.kind === 'mac-app')
      staged = await stageMacApp(file, join(this.root, 'app'), candidate.version).catch((error) => {
        throw new UpdateError(
          `The downloaded app is not valid. ${error instanceof Error ? error.message : ''}`.trim(),
        );
      });
    else if (install.kind === 'appimage') await chmod(file, 0o755);
    signal.throwIfAborted();
    const record: StagedRecord = {
      version: candidate.version,
      name: candidate.name,
      sha256: expected,
      kind: install.kind,
      staged,
    };
    await writeJSON(join(this.root, 'staged.json'), record);
    this.staged = record;
    this.setUpdate({ ...this.state.update!, phase: 'staged' });
  }
  /**
   * Installs the staged release and restarts. The caller must stop or confirm active work
   * first. The download is checked again, so a changed file is never installed.
   */
  async restart() {
    await this.initialize();
    const staged = this.staged;
    if (this.state.update?.phase !== 'staged' || !staged)
      throw new Error('Download and verify the update before you restart.');
    const install = await this.refreshInstall();
    if (!install.selfUpdate || install.kind !== staged.kind)
      throw new Error(install.reason || 'This copy of Kalkidan cannot update itself.');
    try {
      if ((await sha256File(join(this.root, staged.name))) !== staged.sha256)
        throw new UpdateError('The staged download changed. Download the update again.');
      await access(staged.staged);
    } catch (error) {
      await rm(this.root, { recursive: true, force: true }).catch(() => {});
      this.staged = undefined;
      this.setUpdate({
        ...this.state.update,
        phase: 'failed',
        error:
          error instanceof UpdateError
            ? error.message
            : 'The staged download is missing. Download the update again.',
      });
      return this.snapshot();
    }
    this.setUpdate({ ...this.state.update, phase: 'restarting', error: undefined });
    try {
      await (this.options.apply || applyStagedUpdate)({
        installation: install,
        staged: staged.staged,
        result: join(this.root, 'result.txt'),
        pid: this.options.pid ?? process.pid,
        execPath: this.options.execPath || process.execPath,
        quit: () => this.options.quit?.(),
        relaunch: (path) => this.options.relaunch?.(path),
      });
    } catch {
      this.setUpdate({
        ...this.state.update,
        phase: 'staged',
        error: 'Kalkidan could not start the installer. The current version keeps running.',
      });
    }
    return this.snapshot();
  }
}

/** Compare numeric version and build coordinates; never sort version text. */
export function desktopReleaseIsNewer(candidate: string, running: string) {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-build\.(\d+)\.([a-f0-9]{12}))?$/.exec(value);
    return match
      ? { coordinates: match.slice(1, 5).map((part) => BigInt(part || 0)), build: match[5] || '' }
      : undefined;
  };
  const next = parse(candidate),
    current = parse(running);
  if (!next || !current) return candidate !== running;
  for (let index = 0; index < next.coordinates.length; index++) {
    if (next.coordinates[index] !== current.coordinates[index])
      return next.coordinates[index] > current.coordinates[index];
  }
  return next.build !== current.build;
}
