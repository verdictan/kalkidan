import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverRuntime } from '../electron/updates/runtime-feed';
test('runtime discovery accepts public artifact identity without treating it as approval', async () => {
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
      },
    ],
  };
  const request = (async (url: string) => {
    calls++;
    assert.match(url, /verdictan\/packages/);
    return new Response(JSON.stringify([row]));
  }) as typeof fetch;
  assert.deepEqual(await discoverRuntime('darwin', 'arm64', request), {
    version: '0.3.0',
    releaseId: '1',
    sha256: 'a'.repeat(64),
  });
  assert.equal(await discoverRuntime('win32', 'x64', request), undefined);
  assert.equal(calls, 1);
  let pages = 0;
  const paginated = (async (url: string) => {
    pages++;
    assert.equal(new URL(url).searchParams.get('page'), String(pages));
    return new Response(
      JSON.stringify(pages === 1 ? Array(100).fill({ tag_name: 'kalkidan-v0.1.0' }) : [row]),
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
