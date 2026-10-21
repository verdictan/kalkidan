// A fake release feed and an updater fixture for the desktop update tests.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DesktopUpdates, githubReleaseOrigin } from '../../electron/updates/desktop';
import type { DesktopInstallation } from '../../electron/updates/desktop-install';

export const running = '0.1.0-build.100.aaaaaaaaaaaa';
export const next = '0.1.0-build.200.bbbbbbbbbbbb';
export const tag = `kalkidan-v${next}`;
export const download = `${githubReleaseOrigin.download}${tag}/`;
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** A fake GitHub release feed and download server. */
export function server(options: {
  asset: string;
  bytes: Buffer;
  sums?: string;
  digest?: string;
  served?: Buffer;
  redirect?: string;
}) {
  const requests: string[] = [];
  const release = {
    id: 9,
    tag_name: tag,
    html_url: `${githubReleaseOrigin.page}${tag}`,
    published_at: '2026-10-21T00:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: options.asset,
        size: options.bytes.length,
        digest: `sha256:${options.digest || sha(options.bytes)}`,
        browser_download_url: `${download}${options.asset}`,
      },
      {
        name: 'SHA256SUMS.txt',
        size: 100,
        digest: `sha256:${'0'.repeat(64)}`,
        browser_download_url: `${download}SHA256SUMS.txt`,
      },
    ],
  };
  const request = (async (url: string) => {
    requests.push(url);
    const asset = `https://release-assets.githubusercontent.com/${options.asset}`;
    if (url === `${download}SHA256SUMS.txt`)
      return new Response(options.sums ?? `${sha(options.bytes)}  ${options.asset}\n`);
    if (url === `${download}${options.asset}`)
      return new Response(null, {
        status: 302,
        headers: { location: options.redirect || asset },
      });
    if (url === asset) return new Response(new Uint8Array(options.served || options.bytes));
    return new Response('missing', { status: 404 });
  }) as typeof globalThis.fetch;
  return { feed: async () => [release], fetch: request, requests };
}
export async function fixture(
  root: string,
  installation: DesktopInstallation,
  serving: ReturnType<typeof server>,
  extra: Partial<ConstructorParameters<typeof DesktopUpdates>[0]> = {},
) {
  await writeFile(join(root, 'main.cjs'), 'bundle');
  return new DesktopUpdates({
    version: running,
    bundle: join(root, 'main.cjs'),
    journal: join(root, 'updates', 'desktop-discovery.json'),
    platform: 'linux',
    arch: 'x64',
    feed: serving.feed,
    fetch: serving.fetch,
    installation: async () => installation,
    ...extra,
  });
}
export const appImage = (target: string): DesktopInstallation => ({
  kind: 'appimage',
  selfUpdate: true,
  target,
  asset: 'linux-x64.AppImage',
});
