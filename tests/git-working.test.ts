import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '../electron/core';
import {
  gitCommit,
  gitPullRequest,
  parseWorkingStatus,
  removeWorktree,
  workingStatus,
} from '../electron/git-working';
import { readAppearanceMode, saveAppearanceMode, withScheme } from '../electron/storage/appearance';

const identity = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
// The functions under test read the identity from the environment of this process.
Object.assign(process.env, identity);

async function repository() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'git-working-')));
  const repo = join(root, 'repo');
  await exec('git', ['init', '-q', '-b', 'main', repo]);
  await exec('git', ['-C', repo, 'config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'README.md'), 'Hello\n');
  await exec('git', ['-C', repo, 'add', '-A']);
  await exec('git', ['-C', repo, 'commit', '-q', '-m', 'init'], { env: identity });
  return { root, repo };
}

test('parses porcelain v2 status with renames, conflicts, and untracked files', () => {
  const output = [
    '# branch.oid abc',
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +3 -1',
    '1 .M N... 100644 100644 100644 a b src/a.ts',
    '2 R. N... 100644 100644 100644 a b R100 src/new.ts',
    'src/old.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? notes.txt',
    '? other.txt',
    '! ignored.log',
    '',
  ].join('\0');
  assert.deepEqual(parseWorkingStatus(output), {
    branch: 'feature/x',
    upstream: true,
    ahead: 3,
    changed: 3,
    untracked: 2,
  });
  assert.equal(parseWorkingStatus('# branch.head (detached)\0').branch, 'HEAD');
});

test('working status counts changes and compares an unpublished branch with main', async () => {
  const { root, repo } = await repository();
  try {
    let status = await workingStatus(repo);
    assert.deepEqual(status, {
      branch: 'main',
      changed: 0,
      untracked: 0,
      ahead: 0,
      published: false,
      defaultBranch: 'main',
    });
    await writeFile(join(repo, 'README.md'), 'Changed\n');
    await writeFile(join(repo, 'new.txt'), 'New\n');
    status = await workingStatus(repo);
    assert.equal(status.changed, 1);
    assert.equal(status.untracked, 1);
    await exec('git', ['-C', repo, 'switch', '-q', '-c', 'feature']);
    const { commit } = await gitCommit(repo, '  Add a file  ');
    assert.match(commit, /^[0-9a-f]{7,}$/);
    assert.equal(
      (await exec('git', ['-C', repo, 'log', '-1', '--format=%s'])).stdout.trim(),
      'Add a file',
    );
    status = await workingStatus(repo);
    assert.equal(status.branch, 'feature');
    assert.equal(status.changed + status.untracked, 0);
    assert.equal(status.ahead, 1);
    assert.equal(status.published, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('commit rejects an empty message and a clean checkout', async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(join(repo, 'a.txt'), 'A\n');
    await assert.rejects(gitCommit(repo, '   '), /Enter a commit message/);
    await gitCommit(repo, 'Add a');
    await assert.rejects(gitCommit(repo, 'Again'), /no changes to commit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worktree removal rejects the main checkout and uncommitted changes unless forced', async () => {
  const { root, repo } = await repository();
  try {
    const clean = join(root, 'clean');
    const dirty = join(root, 'dirty');
    await exec('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'clean', clean]);
    await exec('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'dirty', dirty]);
    await assert.rejects(removeWorktree(repo), /main checkout cannot be removed/);
    await mkdir(join(clean, 'sub'));
    await assert.rejects(removeWorktree(join(clean, 'sub')), /top folder/);
    await rm(join(clean, 'sub'), { recursive: true });
    await removeWorktree(clean);
    await assert.rejects(access(clean));
    await writeFile(join(dirty, 'scratch.txt'), 'Draft\n');
    await assert.rejects(removeWorktree(dirty), /uncommitted changes/);
    await access(dirty);
    await removeWorktree(dirty, true);
    await assert.rejects(access(dirty));
    const list = (await exec('git', ['-C', repo, 'worktree', 'list', '--porcelain'])).stdout;
    assert.equal(list.split('\n\n').filter(Boolean).length, 1);
    // The branches stay, so that no commits are lost.
    await exec('git', ['-C', repo, 'rev-parse', '--verify', 'dirty']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pull request rejects the default branch and pushes before gh runs', async () => {
  const { root, repo } = await repository();
  try {
    const github = async () => {
      throw new Error('gh must not run');
    };
    await assert.rejects(
      gitPullRequest(repo, 'Title', '', github),
      /Create a branch before you open a pull request/,
    );
    await exec('git', ['-C', repo, 'switch', '-q', '-c', 'feature']);
    await assert.rejects(gitPullRequest(repo, ' ', '', github), /Enter a pull request title/);
    const origin = join(root, 'origin.git');
    await exec('git', ['init', '-q', '--bare', origin]);
    await exec('git', ['-C', repo, 'remote', 'add', 'origin', origin]);
    const script = join(root, 'gh.mjs');
    await writeFile(
      script,
      "console.log('Creating pull request');\n" +
        "console.log('https://github.com/example/repo/pull/7?args=' + " +
        'encodeURIComponent(JSON.stringify(process.argv.slice(2))));\n',
    );
    const result = await gitPullRequest(repo, '-Title', 'Body', async () => ({
      path: process.execPath,
      args: [script],
      env: process.env,
    }));
    const url = new URL(result.url);
    assert.equal(url.pathname, '/example/repo/pull/7');
    assert.deepEqual(JSON.parse(url.searchParams.get('args')!), [
      'pr',
      'create',
      '--title=-Title',
      '--body=Body',
      '--head=feature',
    ]);
    assert.equal((await workingStatus(repo)).published, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('appearance persists for the next start and sets the scheme of the start URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appearance-'));
  try {
    const file = join(root, 'appearance.json');
    assert.equal(await readAppearanceMode(file), 'system');
    await saveAppearanceMode(file, 'dark');
    assert.equal(await readAppearanceMode(file), 'dark');
    await writeFile(file, '{"mode":"sepia"}');
    assert.equal(await readAppearanceMode(file), 'system');
    await assert.rejects(saveAppearanceMode(file, 'sepia' as never), /Invalid appearance/);
    assert.equal(withScheme('http://127.0.0.1:5173', true), 'http://127.0.0.1:5173?scheme=dark');
    assert.equal(
      withScheme('file:///app/index.html', false, '#session=x'),
      'file:///app/index.html?scheme=light#session=x',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
