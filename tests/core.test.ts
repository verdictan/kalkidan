import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, launchCommand, parseWorktrees } from '../electron/core';
import { history } from '../electron/history';
test('shell quoting preserves arbitrary folder names without executing shell syntax', async () => {
  const root = await mkdtemp(join(tmpdir(), 'common-ground-'));
  try {
    const path = join(root, "a 'quote' $(touch NO) `echo bad` space"); await mkdir(path);
    const { stdout } = await exec('/bin/sh', ['-c', launchCommand(path, 'terminal') + ' && pwd']);
    assert.equal(stdout.trim(), path);
    assert.throws(() => launchCommand(path, 'codex', 'bad;command'));
    assert.equal(launchCommand('/tmp', 'codex', 'session-1'), "cd -- '/tmp' && codex resume 'session-1'");
    assert.equal(launchCommand('/tmp', 'claude', 'session-1'), "cd -- '/tmp' && claude --resume 'session-1'");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('git worktree operations support spaces and parse branch paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'common-ground-git-'));
  try {
    await exec('git', ['init', '-b', 'main', root]);
    await exec('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init']);
    const path = join(root, 'feature tree');
    await exec('git', ['-C', root, 'worktree', 'add', '-b', 'feature/test', '--', path]);
    const trees = parseWorktrees((await exec('git', ['-C', root, 'worktree', 'list', '--porcelain'])).stdout);
    assert.deepEqual(trees, [{ path: root, branch: 'main' }, { path, branch: 'feature/test' }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('history reads both agents, skips truncated lines, and handles missing stores', async () => {
  const root = await mkdtemp(join(tmpdir(), 'common-ground-history-'));
  try {
    const codex = join(root, 'codex'), claude = join(root, 'claude');
    await mkdir(join(codex, 'sessions', '2026'), { recursive: true });
    await mkdir(join(claude, 'projects', '-tmp-project'), { recursive: true });
    await writeFile(join(codex, 'sessions', '2026', 'one.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'codex-1', cwd: '/tmp/project' } }) + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Build a thing' } }) + '\n{"truncated":');
    await writeFile(join(claude, 'projects', '-tmp-project', 'two.jsonl'), JSON.stringify({ type: 'user', cwd: '/tmp/project', sessionId: 'claude-1', message: { content: 'Fix a thing' } }));
    const result = await history(codex, claude);
    assert.equal(result.sessions.length, 2); assert.equal(result.warnings.length, 0);
    assert.ok(result.sessions.some(s => s.agent === 'codex' && s.title === 'Build a thing'));
    assert.ok(result.sessions.some(s => s.agent === 'claude' && s.title === 'Fix a thing'));
    assert.deepEqual(await history(join(root, 'missing'), join(root, 'also-missing')), { sessions: [], warnings: [] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
