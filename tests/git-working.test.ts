import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '../electron/core';
import {
  gitCommit,
  gitPullRequest,
  gitSwitchNewBranch,
  parseWorkingFiles,
  parseWorkingStatus,
  removeWorktree,
  workingFiles,
  workingStatus,
  worktreeFolder,
  worktreePreview,
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

test('parses porcelain v1 file entries with renames, conflicts and untracked files', () => {
  const output = [
    ' M src/a.ts',
    'M  src/staged.ts',
    'A  added.ts',
    ' D gone.ts',
    'R  src/new.ts',
    'src/old.ts',
    'UU conflict.ts',
    'AA both-added.ts',
    '?? notes/new file.txt',
    '!! ignored.log',
    '',
  ].join('\0');
  assert.deepEqual(parseWorkingFiles(output), [
    { path: 'src/a.ts', status: 'modified' },
    { path: 'src/staged.ts', status: 'modified' },
    { path: 'added.ts', status: 'added' },
    { path: 'gone.ts', status: 'deleted' },
    { path: 'src/new.ts', status: 'renamed', from: 'src/old.ts' },
    { path: 'conflict.ts', status: 'conflicted' },
    { path: 'both-added.ts', status: 'conflicted' },
    { path: 'notes/new file.txt', status: 'untracked' },
  ]);
  assert.deepEqual(parseWorkingFiles(''), []);
});

test('commit with files commits only those files and keeps other changes', async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(join(repo, 'README.md'), 'Changed\n');
    await mkdir(join(repo, 'docs'));
    await writeFile(join(repo, 'docs', 'a*.md'), 'Star\n');
    await writeFile(join(repo, 'docs', 'ab.md'), 'Other\n');
    await writeFile(join(repo, 'staged.txt'), 'Staged\n');
    await exec('git', ['-C', repo, 'add', '--', 'staged.txt']);
    assert.deepEqual(
      (await workingFiles(repo)).map((file) => [file.path, file.status]),
      [
        ['README.md', 'modified'],
        ['staged.txt', 'added'],
        ['docs/a*.md', 'untracked'],
        ['docs/ab.md', 'untracked'],
      ],
    );
    await assert.rejects(gitCommit(repo, 'Nothing', []), /at least one file/);
    await assert.rejects(gitCommit(repo, 'Clean', ['LICENSE']), /no changes to commit/);
    await gitCommit(repo, 'Docs and readme', ['README.md', 'docs/a*.md']);
    const committed = (
      await exec('git', ['-C', repo, 'show', '--name-only', '--format=', 'HEAD'])
    ).stdout
      .trim()
      .split('\n');
    assert.deepEqual(committed.sort(), ['README.md', 'docs/a*.md']);
    // The other files did not change. The staged file stays staged.
    assert.deepEqual(
      (await workingFiles(repo)).map((file) => [file.path, file.status]),
      [
        ['staged.txt', 'added'],
        ['docs/ab.md', 'untracked'],
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('commit with files includes both paths of a rename and deletions', async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(join(repo, 'old.txt'), 'Old\n');
    await writeFile(join(repo, 'remove.txt'), 'Remove\n');
    await gitCommit(repo, 'Add files');
    await exec('git', ['-C', repo, 'mv', 'old.txt', 'new.txt']);
    await rm(join(repo, 'remove.txt'));
    const files = await workingFiles(repo);
    assert.deepEqual(
      files.find((file) => file.path === 'new.txt'),
      {
        path: 'new.txt',
        status: 'renamed',
        from: 'old.txt',
      },
    );
    await gitCommit(repo, 'Rename and remove', ['new.txt', 'remove.txt']);
    assert.deepEqual(await workingFiles(repo), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('switch to a new branch keeps the changes and rejects invalid names', async () => {
  const { root, repo } = await repository();
  try {
    await writeFile(join(repo, 'README.md'), 'Draft\n');
    await assert.rejects(gitSwitchNewBranch(repo, 'bad name'), /not a valid branch name/);
    await assert.rejects(gitSwitchNewBranch(repo, '-x'), /valid new branch name/);
    await gitSwitchNewBranch(repo, 'feature/draft');
    const status = await workingStatus(repo);
    assert.equal(status.branch, 'feature/draft');
    assert.equal(status.changed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worktree preview shows the base branch and the folder that it creates', async () => {
  const { root, repo } = await repository();
  try {
    const projectRoot = join(root, 'project');
    const none = () => false;
    assert.deepEqual(await worktreePreview(repo, 'feature/x', projectRoot, none), {
      base: 'main',
      path: join(projectRoot, 'worktrees', 'repo-feature-x'),
    });
    await assert.rejects(worktreePreview(repo, 'a..b', projectRoot, none), /not a valid/);
    const taken = new Set([join(projectRoot, 'worktrees', 'repo-feature-x')]);
    assert.equal(
      worktreeFolder(projectRoot, 'repo', 'feature/x', (path) => taken.has(path)),
      join(projectRoot, 'worktrees', 'repo-feature-x-2'),
    );
    await exec('git', ['-C', repo, 'switch', '-q', '--detach']);
    const detached = await worktreePreview(repo, 'topic', projectRoot, none);
    assert.match(detached.base, /^[0-9a-f]{7,}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
