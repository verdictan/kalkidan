import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, parseWorktrees } from '../electron/core';
import { worktreeSessions } from '../src/lib/worktree-sessions';
import type { Session } from '../src/types';

test('discovers externally created agent worktrees and assigns chats by checkout and host', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-worktrees-')));
  const repo = join(root, 'repo');
  const external = join(root, 'codex-checkout');
  try {
    await exec('git', ['init', '-b', 'main', repo]);
    await exec('git', [
      '-C',
      repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'init',
    ]);
    await exec('git', ['-C', repo, 'worktree', 'add', '-b', 'codex/task', external]);
    const nested = join(repo, '.claude', 'worktrees', 'task');
    await exec('git', ['-C', repo, 'worktree', 'add', '-b', 'claude/task', nested]);
    const trees = parseWorktrees(
      (await exec('git', ['-C', repo, 'worktree', 'list', '--porcelain'])).stdout,
    );
    assert.equal(trees.length, 3);
    const chat = (id: string, cwd: string, agent: Session['agent'], hostId?: string): Session => ({
      id,
      cwd,
      agent,
      hostId,
      title: id,
      updatedAt: '2026-10-18',
    });
    const sessions = [
      chat('codex', external + '/src', 'codex'),
      chat('claude', nested, 'claude'),
      chat('remote', external, 'codex', 'ssh-host'),
      chat('prefix-collision', external + '-other', 'codex'),
    ];
    assert.deepEqual(
      worktreeSessions(external, trees, sessions).map((s) => s.id),
      ['codex'],
    );
    assert.deepEqual(
      worktreeSessions(nested, trees, sessions).map((s) => s.id),
      ['claude'],
    );
    assert.deepEqual(worktreeSessions(repo, trees, sessions), []);
    assert.deepEqual(
      worktreeSessions(external, trees, sessions, 'ssh-host').map((s) => s.id),
      ['remote'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
