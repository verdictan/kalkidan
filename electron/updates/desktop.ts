import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { DesktopUpdateStatus } from '../../src/domain/updates';
import { writeJSON } from '../storage/atomic-json';

export type ReleaseFeed = (page: number, signal: AbortSignal) => Promise<unknown>;
export const desktopReleaseFeed: ReleaseFeed = async (page, signal) => {
  const response = await fetch(
    `https://api.github.com/repos/verdictan/packages/releases?per_page=100&page=${page}`,
    {
      signal,
      redirect: 'error',
      headers: { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
    },
  );
  if (!response.ok) throw new Error('Release discovery is unavailable.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body!) {
    size += chunk.byteLength;
    if (size > 4 * 1024 * 1024) throw new Error('Release metadata exceeds its size limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
/** Discovery is informational. It never authorizes or installs an executable. */
export class DesktopUpdates {
  private state: DesktopUpdateStatus;
  private pending?: Promise<DesktopUpdateStatus>;
  private initialized = false;
  constructor(
    private options: {
      version: string;
      bundle: string;
      journal: string;
      platform: string;
      arch: string;
      feed?: ReleaseFeed;
      now?: () => number;
      changed?(): void;
    },
  ) {
    this.state = {
      installedVersion: options.version,
      runningVersion: options.version,
      runningBuild: 'unknown',
      discovery: 'unknown',
      stale: true,
    };
  }
  private now() {
    return (this.options.now || Date.now)();
  }
  async status(force = false): Promise<DesktopUpdateStatus> {
    if (this.pending) return structuredClone(await this.pending);
    if (
      !force &&
      this.state.lastSuccessAt &&
      this.now() - this.state.lastSuccessAt < 6 * 60 * 60 * 1000
    )
      return structuredClone(this.state);
    const task = this.check();
    this.pending = task;
    try {
      return structuredClone(await task);
    } finally {
      if (this.pending === task) this.pending = undefined;
    }
  }
  private async check() {
    if (!this.initialized) {
      this.initialized = true;
      this.state.runningBuild = await readFile(this.options.bundle)
        .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
        .catch(() => 'unknown');
      try {
        const saved = JSON.parse(await readFile(this.options.journal, 'utf8'));
        if (saved.runningVersion === this.options.version && this.validRelease(saved.release)) {
          this.state.release = saved.release;
          if (Number.isFinite(saved.lastSuccessAt) && saved.lastSuccessAt <= this.now())
            this.state.lastSuccessAt = saved.lastSuccessAt;
        }
      } catch {
        /* A missing or damaged discovery cache must not block the app. */
      }
    }
    this.state = {
      ...this.state,
      discovery: 'checking',
      stale: true,
      lastAttemptAt: this.now(),
      error: undefined,
    };
    this.options.changed?.();
    try {
      const platform = { darwin: 'mac', linux: 'linux', win32: 'win' }[this.options.platform];
      if (!platform || !['arm64', 'x64'].includes(this.options.arch)) {
        this.state.discovery = 'unsupported';
        return this.state;
      }
      const extension = { mac: 'dmg', linux: 'AppImage', win: 'exe' }[platform];
      const signal = AbortSignal.timeout(30000);
      let found = false;
      for (let page = 1; page <= 5 && !found; page++) {
        const response = await (this.options.feed || desktopReleaseFeed)(page, signal);
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
          const name = `Kalkidan-${version}-${platform}-${this.options.arch}.${extension}`;
          const asset =
            Array.isArray(release.assets) &&
            release.assets.find((asset: any) => asset.name === name);
          if (!asset) continue;
          const value = {
            version,
            id: String(release.id),
            url: release.html_url,
            sha256: typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '') : '',
            publishedAt: release.published_at,
          };
          if (!this.validRelease(value))
            throw new Error('Release identity or digest is incomplete.');
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
      await writeJSON(this.options.journal, this.state);
    } catch {
      this.state.discovery = 'failed';
      this.state.stale = true;
      this.state.error =
        'Could not verify the release feed. The last known release is shown. Try again when online.';
    } finally {
      this.options.changed?.();
    }
    return this.state;
  }
  private validRelease(value: any): value is NonNullable<DesktopUpdateStatus['release']> {
    return (
      value &&
      typeof value.version === 'string' &&
      /^\d+$/.test(value.id) &&
      typeof value.url === 'string' &&
      /^https:\/\/github\.com\/verdictan\/packages\/releases\/tag\/kalkidan-v[\w.-]+$/.test(
        value.url,
      ) &&
      typeof value.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.sha256) &&
      typeof value.publishedAt === 'string' &&
      Number.isFinite(Date.parse(value.publishedAt))
    );
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
