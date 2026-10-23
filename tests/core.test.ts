import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { history, historyWithManaged } from '../electron/history';
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
test('history uses a short title from the first Codex user response item', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-title-'));
  try {
    const codex = join(root, 'codex');
    await mkdir(join(codex, 'sessions'), { recursive: true });
    const message = (text: string) =>
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
    await writeFile(
      join(codex, 'sessions', 'rollout.jsonl'),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: 'sess-1', cwd: '/tmp/project' } }),
        message('# AGENTS.md instructions for /tmp/project\n\nUse tabs.'),
        message('<environment_context>\n  <cwd>/tmp/project</cwd>\n</environment_context>'),
        message('Add a dark mode toggle to the header'),
      ].join('\n'),
    );
    const result = await history(codex, join(root, 'claude'));
    assert.deepEqual(
      result.sessions.map((s) => s.title),
      ['Add a dark mode toggle'],
    );
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

test('managed history includes subscription homes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-managed-history-'));
  try {
    const home = join(root, 'managed-agent-homes', 'a'.repeat(64));
    const claudeLine = (id: string, title: string) =>
      JSON.stringify({
        type: 'user',
        cwd: '/tmp/project',
        sessionId: id,
        message: { content: title },
      });
    for (const [folder, id, title] of [
      ['claude', 'claude-byok', 'BYOK chat'],
      ['claude-subscription', 'claude-sub', 'Subscription chat'],
    ]) {
      await mkdir(join(home, folder, 'projects', '-tmp-project'), { recursive: true });
      await writeFile(
        join(home, folder, 'projects', '-tmp-project', `${id}.jsonl`),
        claudeLine(id, title),
      );
    }
    await mkdir(join(home, 'codex-subscription', 'sessions'), { recursive: true });
    await writeFile(
      join(home, 'codex-subscription', 'sessions', 'one.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-sub', cwd: '/tmp/project' } }) +
        '\n' +
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Codex plan' },
        }),
    );
    const result = await historyWithManaged(root, join(root, 'none'), join(root, 'none'));
    assert.deepEqual(result.sessions.map((s) => s.title).sort(), [
      'BYOK chat',
      'Codex plan',
      'Subscription chat',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
