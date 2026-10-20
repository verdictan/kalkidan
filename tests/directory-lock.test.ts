import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
test('filesystem leases release on success and failure, and reject writes after ownership loss', async () => {
  let target = '';
  let options: any,
    releases = 0,
    failed = false;
  const { withDirectoryLock } = backendLoader({
    'node:fs/promises': { realpath: async (path: string) => path },
    'proper-lockfile': {
      lock: async (_path: string, opts: any) => {
        target = _path;
        options = opts;
        if (failed) throw Error('locked');
        return async () => {
          releases++;
        };
      },
    },
  })(resolve('electron/storage/directory-lock.ts'));
  assert.equal(
    await withDirectoryLock('/memory', async (assertOwned: () => void) => {
      assertOwned();
      return 7;
    }),
    7,
  );
  assert.equal(releases, 1);
  await assert.rejects(
    withDirectoryLock('/memory', async () => {
      throw Error('write failed');
    }),
    /write failed/,
  );
  assert.equal(releases, 2);
  await assert.rejects(
    withDirectoryLock('/memory', async (assertOwned: () => void) => {
      options.onCompromised();
      assertOwned();
    }),
    /ownership was lost/,
  );
  assert.equal(releases, 2);
  await withDirectoryLock('/memory', async () => {}, 'a'.repeat(64));
  assert.equal(target, '/memory/.' + 'a'.repeat(64));
  assert.equal(options.realpath, false);
  await assert.rejects(
    withDirectoryLock('/memory', async () => {}, '../bad'),
    /Invalid/,
  );
  failed = true;
  await assert.rejects(
    withDirectoryLock('/memory', async () => {}),
    /locked/,
  );
});
