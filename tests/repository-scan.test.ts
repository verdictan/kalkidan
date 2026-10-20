import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBranch, scanRepositories } from '../electron/repository-scan';

/** Makes a folder look like a repository without Git: a .git folder with a HEAD file. */
async function repository(path: string, branch = 'main') {
  await mkdir(join(path, '.git'), { recursive: true });
  await writeFile(join(path, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
}

async function temporary() {
  return realpath(await mkdtemp(join(tmpdir(), 'repository-scan-')));
}

test('finds nested repositories and reads their branches', async () => {
  const root = await temporary();
  try {
    await repository(join(root, 'web'), 'main');
    await repository(join(root, 'services', 'api'), 'feature/rate-limits');
    await repository(join(root, 'services', 'api', 'inner'));
    await mkdir(join(root, 'notes'));
    const scan = await scanRepositories(root);
    assert.equal(scan.root, root);
    assert.equal(scan.rootIsRepository, false);
    assert.equal(scan.truncated, false);
    assert.deepEqual(scan.repositories, [
      { path: join(root, 'services', 'api'), name: 'api', branch: 'feature/rate-limits' },
      { path: join(root, 'web'), name: 'web', branch: 'main' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skips hidden folders, node_modules, build folders and symbolic links', async () => {
  const root = await temporary();
  try {
    await repository(join(root, '.cache', 'hidden'));
    await repository(join(root, 'node_modules', 'package'));
    await repository(join(root, 'dist', 'output'));
    await repository(join(root, 'vendor', 'library'));
    await repository(join(root, 'kept'));
    await symlink(join(root, 'kept'), join(root, 'link'));
    const scan = await scanRepositories(root);
    assert.deepEqual(
      scan.repositories.map((repo) => repo.name),
      ['kept'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stops at the depth limit', async () => {
  const root = await temporary();
  try {
    await repository(join(root, 'a', 'b', 'level3'));
    await repository(join(root, 'a', 'b', 'c', 'level4'));
    const scan = await scanRepositories(root);
    assert.deepEqual(
      scan.repositories.map((repo) => repo.name),
      ['level3'],
    );
    const deeper = await scanRepositories(root, { depth: 4 });
    assert.deepEqual(
      deeper.repositories.map((repo) => repo.name),
      ['level4', 'level3'], // Sorted by path: a/b/c/level4 comes before a/b/level3.
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a repository root also lists separate repositories, but not submodules', async () => {
  const root = await temporary();
  try {
    await repository(root, 'develop');
    await repository(join(root, 'packages', 'tool'));
    // A submodule has a .git file that points into the Git folder of the parent.
    await mkdir(join(root, '.git', 'modules', 'sub'), { recursive: true });
    await writeFile(join(root, '.git', 'modules', 'sub', 'HEAD'), 'ref: refs/heads/main\n');
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n');
    const scan = await scanRepositories(root);
    assert.equal(scan.rootIsRepository, true);
    assert.deepEqual(scan.repositories, [
      { path: root, name: root.split('/').pop(), branch: 'develop' },
      { path: join(root, 'packages', 'tool'), name: 'tool', branch: 'main' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a worktree with a .git file counts as a repository', async () => {
  const root = await temporary();
  try {
    const gitDirectory = join(root, 'main-checkout', '.git', 'worktrees', 'feature');
    await repository(join(root, 'main-checkout'));
    await mkdir(gitDirectory, { recursive: true });
    await writeFile(join(gitDirectory, 'HEAD'), 'ref: refs/heads/feature/x\n');
    await mkdir(join(root, 'feature'));
    await writeFile(join(root, 'feature', '.git'), `gitdir: ${gitDirectory}\n`);
    const scan = await scanRepositories(root);
    assert.deepEqual(scan.repositories, [
      { path: join(root, 'feature'), name: 'feature', branch: 'feature/x' },
      { path: join(root, 'main-checkout'), name: 'main-checkout', branch: 'main' },
    ]);
    // A detached HEAD has no branch.
    await writeFile(join(gitDirectory, 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    assert.equal(await readBranch(join(root, 'feature')), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stops at the repository limit and rejects a missing folder', async () => {
  const root = await temporary();
  try {
    for (const name of ['a', 'b', 'c']) await repository(join(root, name));
    const scan = await scanRepositories(root, { limit: 2 });
    assert.equal(scan.repositories.length, 2);
    assert.equal(scan.truncated, true);
    await assert.rejects(scanRepositories(join(root, 'missing')), /does not exist/);
    await writeFile(join(root, 'file.txt'), '');
    await assert.rejects(scanRepositories(join(root, 'file.txt')), /Choose a folder/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
