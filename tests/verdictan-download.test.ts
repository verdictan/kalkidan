import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadRuntime } from '../electron/verdictan/download';
import { sha256, type RuntimeArtifact } from '../electron/verdictan/release';
import { backendLoader } from './helpers/backend-loader';
const artifact = {
  url: 'https://releases.test/runtime',
  size: 3,
  sha256: sha256('abc'),
} as RuntimeArtifact;
test('runtime downloads bound redirects, reject partial/error responses, and cancel on abort', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let n = 0;
  const get = (
    request: () => Response | Promise<Response>,
    signal = new AbortController().signal,
    origins = ['https://releases.test'],
  ) =>
    downloadRuntime(
      artifact,
      join(root, String(++n)),
      origins,
      signal,
      () => {},
      request as typeof fetch,
    );
  await get(() => new Response('abc', { headers: { 'content-length': '3' } }));
  assert.equal(await readFile(join(root, '1'), 'utf8'), 'abc');
  let redirects = 0;
  await get(() =>
    ++redirects === 1
      ? new Response(null, { status: 302, headers: { location: '/asset' } })
      : new Response('abc'),
  );
  assert.equal(redirects, 2);
  await assert.rejects(
    get(() => new Response(null, { status: 302, headers: { location: '/loop' } })),
    /too many/,
  );
  await assert.rejects(
    get(() => new Response(null, { status: 302 })),
    /too many/,
  );
  await assert.rejects(
    get(() => new Response(null, { status: 503 })),
    /unavailable/,
  );
  await assert.rejects(
    get(() => new Response(null, { status: 204 })),
    /unavailable/,
  );
  await assert.rejects(
    get(() => new Response('abc', { headers: { 'content-length': '4' } })),
    /size/,
  );
  await assert.rejects(
    get(() => new Response('abcd')),
    /size/,
  );
  await assert.rejects(
    get(() => new Response('ab')),
    /checksum/,
  );
  await assert.rejects(
    get(() => new Response('abc'), undefined, []),
    /not approved/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    get(() => new Response('abc'), controller.signal),
    /abort/i,
  );
});
test('short file writes complete and disk failures close both streams', async () => {
  let fail = '',
    closed = 0,
    canceled = 0,
    writes = 0;
  const { downloadRuntime: download } = backendLoader({
    'node:fs/promises': {
      open: async () => {
        if (fail === 'open') throw Error('disk failure');
        return {
          write: async () => {
            writes++;
            return { bytesWritten: fail === 'write' ? 0 : 1 };
          },
          sync: async () => {},
          close: async () => {
            closed++;
          },
        };
      },
    },
  })(resolve('electron/verdictan/download.ts'));
  const request = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true };
            done = true;
            return { done: false, value: Buffer.from('abc') };
          },
          cancel: async () => {
            canceled++;
          },
        };
      },
    },
  });
  const run = () =>
    download(
      artifact,
      '/runtime',
      ['https://releases.test'],
      new AbortController().signal,
      () => {},
      request,
    );
  await run();
  assert.equal(writes, 3);
  assert.equal(closed, 1);
  fail = 'write';
  await assert.rejects(run(), /written/);
  assert.equal(closed, 2);
  fail = 'open';
  await assert.rejects(run(), /disk failure/);
  assert.equal(closed, 2);
  assert.equal(canceled, 3);
});
