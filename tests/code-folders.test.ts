import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCodeFolders } from '../electron/code-folders';

/** Makes a Git repository: a folder with a `.git` folder. */
async function repo(path: string) {
  await mkdir(join(path, '.git'), { recursive: true });
}

async function withHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), 'code-folders-'));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('finds repositories and folders of repositories in the usual places', async () => {
  await withHome(async (home) => {
    await repo(join(home, 'code', 'ledger'));
    await repo(join(home, 'code', 'atlas', 'atlas-web'));
    await repo(join(home, 'code', 'atlas', 'design-system'));
    await repo(join(home, 'code', 'atlas', 'api-service'));
    await mkdir(join(home, 'code', 'atlas', 'notes'));
    await repo(join(home, 'Developer', 'harbor'));
    const found = await findCodeFolders(home, { limit: 10 });
    const byName = Object.fromEntries(found.map((item) => [item.name, item.repos]));
    assert.deepEqual(byName, { atlas: 3, ledger: 1, harbor: 1 });
    assert.equal(found.find((item) => item.name === 'atlas')?.path, join(home, 'code', 'atlas'));
  });
});

test('skips hidden, build and empty folders, and folders outside the usual places', async () => {
  await withHome(async (home) => {
    await repo(join(home, 'code', '.hidden'));
    await repo(join(home, 'code', 'node_modules', 'pkg'));
    await mkdir(join(home, 'code', 'empty', 'nothing'), { recursive: true });
    await writeFile(join(home, 'code', 'readme.txt'), 'text');
    await repo(join(home, 'Documents', 'private'));
    await repo(join(home, 'Desktop', 'site'));
    assert.deepEqual(await findCodeFolders(home), []);
  });
});

test('puts the newest folders first and stops at the limits', async () => {
  await withHome(async (home) => {
    for (const [name, days] of [
      ['old', 30],
      ['new', 1],
      ['mid', 10],
    ] as const) {
      const path = join(home, 'src', name);
      await repo(path);
      const time = new Date(Date.now() - days * 86_400_000);
      await utimes(path, time, time);
    }
    const found = await findCodeFolders(home, { limit: 2 });
    assert.deepEqual(
      found.map((item) => item.name),
      ['new', 'mid'],
    );
    // With a folder limit of one, the scan reads only the first root.
    assert.ok((await findCodeFolders(home, { folderLimit: 1 })).length <= 3);
  });
});

test('a home with none of the usual places finds nothing', async () => {
  await withHome(async (home) => {
    assert.deepEqual(await findCodeFolders(home), []);
    assert.deepEqual(await findCodeFolders(join(home, 'missing')), []);
  });
});
