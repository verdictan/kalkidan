import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, launchCommand, parseWorktrees } from '../electron/core';
test('shell quoting preserves arbitrary folder names without executing shell syntax', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-'));
  try {
    const path = join(root, "a 'quote' $(touch NO) `echo bad` space");
    await mkdir(path);
    const { stdout } = await exec('/bin/sh', ['-c', launchCommand(path, 'terminal') + ' && pwd']);
    assert.equal(stdout.trim(), path);
    // Agents run only as managed agents. A terminal never resumes a local agent CLI.
    assert.throws(() => launchCommand(path, 'codex' as any));
    assert.throws(() => launchCommand('/tmp', 'claude' as any));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('git worktree operations support spaces and parse branch paths', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kalkidan-git-')));
  try {
    await exec('git', ['init', '-b', 'main', root]);
    await exec('git', [
      '-C',
      root,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ]);
    const path = join(root, 'feature tree');
    await exec('git', ['-C', root, 'worktree', 'add', '-b', 'feature/test', '--', path]);
    const trees = parseWorktrees(
      (await exec('git', ['-C', root, 'worktree', 'list', '--porcelain'])).stdout,
    );
    assert.deepEqual(trees, [
      { path: root, branch: 'main' },
      { path, branch: 'feature/test' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
