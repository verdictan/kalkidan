import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverRuntime } from '../electron/updates/runtime-feed';
const latest = 'https://github.com/verdictan/packages/releases/latest';
const base = 'https://github.com/verdictan/packages/releases';
test('runtime discovery finds the newest published archive and its size', async () => {
  let calls = 0;
  const row = {
    id: 1,
    tag_name: 'v0.3.0',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'verdictan-aarch64-apple-darwin.tar.gz',
        browser_download_url:
          'https://github.com/verdictan/packages/releases/download/v0.3.0/verdictan-aarch64-apple-darwin.tar.gz',
        digest: 'sha256:' + 'a'.repeat(64),
        size: 1024,
      },
    ],
  };
  const request = (async (url: string) => {
    if (url === latest) return new Response('', { status: 404 });
    calls++;
    assert.match(url, /verdictan\/packages/);
    return new Response(JSON.stringify([row]));
  }) as typeof fetch;
  assert.deepEqual(await discoverRuntime('darwin', 'arm64', request), {
    version: '0.3.0',
    releaseId: '1',
    sha256: 'a'.repeat(64),
    size: 1024,
  });
  assert.equal(await discoverRuntime('win32', 'x64', request), undefined);
  assert.equal(calls, 1);
  let pages = 0;
  const paginated = (async (url: string) => {
    if (url === latest) return new Response('', { status: 404 });
    pages++;
    assert.equal(new URL(url).searchParams.get('page'), String(pages));
    // A page of 100 releases is more than the 4 MiB limit, so a page has 30 releases.
    assert.equal(new URL(url).searchParams.get('per_page'), '30');
    return new Response(
      JSON.stringify(pages === 1 ? Array(30).fill({ tag_name: 'kalkidan-v0.1.0' }) : [row]),
    );
  }) as typeof fetch;
  assert.equal((await discoverRuntime('darwin', 'arm64', paginated))?.version, '0.3.0');
  assert.equal(pages, 2);
  row.assets[0].browser_download_url = 'https://untrusted.example/runtime';
  await assert.rejects(discoverRuntime('darwin', 'arm64', request), /identity/);
  await assert.rejects(
    discoverRuntime(
      'darwin',
      'arm64',
      (async () => new Response('', { status: 503 })) as typeof fetch,
    ),
    /unavailable/,
  );
});

test('runtime discovery uses the latest release redirect before the GitHub API', async () => {
  const archive = `${base}/download/v0.6.7/verdictan-x86_64-unknown-linux-gnu.tar.gz`;
  const seen: string[] = [];
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
  const request = (async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    if (url === latest) return redirect(`${base}/tag/v0.6.7`);
    if (url === `${base}/download/v0.6.7/sha256.sum`)
      return new Response(
        `${'b'.repeat(64)}  verdictan-aarch64-apple-darwin.tar.gz\n${'c'.repeat(64)}  verdictan-x86_64-unknown-linux-gnu.tar.gz\n`,
      );
    if (url === archive)
      return redirect('https://release-assets.githubusercontent.com/github-production/archive');
    if (url.startsWith('https://release-assets.githubusercontent.com/'))
      return new Response('x', { headers: { 'content-length': '2048' } });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  assert.deepEqual(await discoverRuntime('linux', 'x64', request), {
    version: '0.6.7',
    releaseId: 'tag:v0.6.7',
    sha256: 'c'.repeat(64),
    size: 2048,
  });
  assert.ok(!seen.some((url) => url.startsWith('https://api.github.com/')));

  // A latest release that is not a Verdictan CLI release falls back to the API.
  let api = 0;
  const fallback = (async (input: string | URL) => {
    const url = String(input);
    if (url === latest) return redirect(`${base}/tag/kalkidan-v0.1.0-build.1.abcdefabcdef`);
    api++;
    assert.match(url, /^https:\/\/api\.github\.com\//);
    return new Response(
      JSON.stringify([
        {
          id: 7,
          tag_name: 'v0.6.7',
          assets: [
            {
              name: 'verdictan-x86_64-unknown-linux-gnu.tar.gz',
              browser_download_url: archive,
              digest: 'sha256:' + 'c'.repeat(64),
              size: 2048,
            },
          ],
        },
      ]),
    );
  }) as typeof fetch;
  assert.equal((await discoverRuntime('linux', 'x64', fallback))?.releaseId, '7');
  assert.equal(api, 1);
});
