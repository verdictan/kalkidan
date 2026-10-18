import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, launchCommand, parseWorktrees } from '../electron/core';
import { history } from '../electron/history';
test('shell quoting preserves arbitrary folder names without executing shell syntax', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-'));
  try {
    const path = join(root, "a 'quote' $(touch NO) `echo bad` space");
    await mkdir(path);
    const { stdout } = await exec('/bin/sh', ['-c', launchCommand(path, 'terminal') + ' && pwd']);
    assert.equal(stdout.trim(), path);
    assert.throws(() => launchCommand(path, 'codex', 'bad;command'));
    assert.equal(
      launchCommand('/tmp', 'codex', 'session-1'),
      "cd -- '/tmp' && codex resume 'session-1'",
    );
    assert.equal(
      launchCommand('/tmp', 'claude', 'session-1'),
      "cd -- '/tmp' && claude --resume 'session-1'",
    );
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
test('history reads both agents, skips truncated lines, and handles missing stores', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-history-'));
  try {
    const codex = join(root, 'codex'),
      claude = join(root, 'claude');
    await mkdir(join(codex, 'sessions', '2026'), { recursive: true });
    await mkdir(join(claude, 'projects', '-tmp-project'), { recursive: true });
    await writeFile(
      join(codex, 'sessions', '2026', 'one.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-1', cwd: '/tmp/project' } }) +
        '\n' +
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Build a thing' },
        }) +
        '\n{"truncated":',
    );
    await writeFile(
      join(claude, 'projects', '-tmp-project', 'two.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd: '/tmp/project',
        sessionId: 'claude-1',
        message: { content: 'Fix a thing' },
      }),
    );
    const result = await history(codex, claude);
    assert.equal(result.sessions.length, 2);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.sessions.some((s) => s.agent === 'codex' && s.title === 'Build a thing'));
    assert.ok(result.sessions.some((s) => s.agent === 'claude' && s.title === 'Fix a thing'));
    assert.deepEqual(await history(join(root, 'missing'), join(root, 'also-missing')), {
      sessions: [],
      warnings: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('history matches projects opened through symlinked folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-links-'));
  try {
    const project = join(root, 'project');
    const alias = join(root, 'alias');
    const codex = join(root, 'codex');
    const claude = join(root, 'claude');
    await mkdir(project);
    await symlink(project, alias);
    await mkdir(join(codex, 'sessions'), { recursive: true });
    await mkdir(join(claude, 'projects'), { recursive: true });
    await writeFile(
      join(codex, 'sessions', 'one.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-link', cwd: alias } }),
    );
    await writeFile(
      join(claude, 'projects', 'one.jsonl'),
      JSON.stringify({ type: 'user', sessionId: 'claude-link', cwd: alias }),
    );
    const result = await history(codex, claude);
    assert.equal(result.sessions.length, 2);
    for (const session of result.sessions) assert.equal(session.cwd, await realpath(project));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('history includes indexed Codex threads and excludes native archives even when JSONL remains', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { codexTranscript } = await import('../electron/codex-store');
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-index-'));
  try {
    await mkdir(join(root, 'sessions'));
    const db = new DatabaseSync(join(root, 'state_5.sqlite'));
    db.exec(
      'CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at INTEGER, archived INTEGER, rollout_path TEXT)',
    );
    const add = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)');
    add.run(
      'new',
      '/tmp/missing-project',
      'Indexed conversation',
      1700000000,
      0,
      '/missing/rollout.jsonl',
    );
    add.run('archived', '/tmp/project', 'Archived', 1700000000, 1, '');
    db.close();
    await writeFile(
      join(root, 'sessions', 'archived.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'archived', cwd: '/tmp/project' } }),
    );
    const result = await history(root, join(root, 'claude'));
    assert.deepEqual(
      result.sessions.map((s) => s.id),
      ['new'],
    );
    assert.equal(result.sessions[0].title, 'Indexed conversation');
    assert.equal(result.warnings.length, 0);
    const transcript = new DatabaseSync(join(root, 'thread_history_1.sqlite'));
    transcript.exec(
      'CREATE TABLE thread_items (thread_id TEXT, item_type TEXT, rollout_ordinal INTEGER, item_json TEXT)',
    );
    const item = transcript.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?)');
    item.run(
      'new',
      'userMessage',
      1,
      JSON.stringify({
        id: 'u',
        type: 'userMessage',
        content: [{ type: 'text', text: 'Original prompt' }],
      }),
    );
    item.run('new', 'reasoning', 2, JSON.stringify({ text: 'Hidden' }));
    item.run(
      'new',
      'agentMessage',
      3,
      JSON.stringify({ id: 'a', type: 'agentMessage', text: 'Original answer' }),
    );
    item.run(
      'other',
      'agentMessage',
      4,
      JSON.stringify({ id: 'b', type: 'agentMessage', text: 'Unrelated' }),
    );
    transcript.close();
    assert.deepEqual(
      (await codexTranscript(root, 'new')).messages.map((m) => m.text),
      ['Original prompt', 'Original answer'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('history scans beyond 300 sessions and large initial records without listing Claude subagents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-all-'));
  try {
    const project = join(root, 'projects', 'project');
    await mkdir(join(project, 'subagents'), { recursive: true });
    await Promise.all(
      Array.from({ length: 305 }, (_, i) =>
        writeFile(
          join(project, `${i}.jsonl`),
          JSON.stringify({
            type: 'user',
            sessionId: `c-${i}`,
            cwd: '/tmp/project',
            message: { content: 'Session ' + i },
          }),
        ),
      ),
    );
    await writeFile(
      join(project, 'large.jsonl'),
      JSON.stringify({ type: 'progress', data: 'x'.repeat(150000) }) +
        '\n' +
        JSON.stringify({
          type: 'user',
          sessionId: 'large',
          cwd: '/tmp/project',
          message: { content: 'After large record' },
        }),
    );
    await writeFile(
      join(project, 'subagents', 'agent-1.jsonl'),
      JSON.stringify({
        type: 'user',
        sessionId: 'subagent',
        cwd: '/tmp/project',
        isSidechain: true,
      }),
    );
    const result = await history(join(root, 'missing'), root);
    assert.equal(result.sessions.length, 306);
    assert.ok(result.sessions.some((s) => s.title === 'After large record'));
    assert.equal(result.warnings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
