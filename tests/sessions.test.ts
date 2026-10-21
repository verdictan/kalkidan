import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionLibrary, validateOrganization } from '../electron/session-library';
import { parseTranscript, readTranscript, visibleUserText } from '../electron/transcript';
import { chatArgs, applyChatEvent, normalizeChatFailure } from '../electron/chat';
import type { ChatRun } from '../src/types';

test('session organization persists, merges concurrent changes, and separates agent IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cg-sessions-'));
  try {
    const file = join(root, 'sessions.json');
    const library = new SessionLibrary(file);
    await library.load();
    await Promise.all([
      library.update('codex', 'same', { title: 'Custom title', pinned: true }),
      library.update('codex', 'same', { notes: 'Next steps', collection: 'Website' }),
      library.update('claude', 'same', { archived: true }),
    ]);
    const restored = new SessionLibrary(file);
    await restored.load();
    const base = { id: 'same', cwd: root, title: 'Original', updatedAt: '' };
    const sessions = restored.decorate([
      { ...base, agent: 'codex' },
      { ...base, agent: 'claude' },
    ]);
    assert.deepEqual(sessions[0].organization, {
      title: 'Custom title',
      pinned: true,
      notes: 'Next steps',
      collection: 'Website',
    });
    assert.deepEqual(sessions[1].organization, { archived: true });
    assert.equal(sessions[0].title, 'Original');
    assert.throws(() => validateOrganization({ pinned: 'yes' }));
    await writeFile(file, 'invalid');
    await assert.rejects(new SessionLibrary(file).load());
    assert.equal(await readFile(file, 'utf8'), 'invalid');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('transcripts render user and assistant text without duplicating Codex events or exposing tool records', async () => {
  const codex = [
    { type: 'event_msg', payload: { type: 'user_message', message: 'Hi' } },
    {
      type: 'response_item',
      payload: { role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
    },
    {
      type: 'response_item',
      payload: { role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] },
    },
    {
      type: 'response_item',
      payload: { role: 'developer', content: [{ type: 'input_text', text: 'Internal' }] },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n');
  assert.deepEqual(
    parseTranscript(codex, 'codex').map((m) => m.text),
    ['Hi', 'Hello'],
  );
  const claude = [
    { uuid: '1', type: 'user', message: { content: 'Hi' } },
    {
      uuid: '2',
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'thinking', thinking: 'hidden' },
        ],
      },
    },
    { uuid: '2', type: 'assistant', message: { content: 'Duplicate' } },
    {
      uuid: '3',
      type: 'user',
      message: { content: [{ type: 'tool_result', content: 'Tool output' }] },
    },
    { uuid: '4', type: 'assistant', isSidechain: true, message: { content: 'Subagent' } },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n');
  assert.deepEqual(
    parseTranscript(claude + '\n{"partial":', 'claude').map((m) => m.text),
    ['Hi', 'Hello'],
  );
  const root = await mkdtemp(join(tmpdir(), 'cg-transcript-'));
  try {
    const file = join(root, 'history.jsonl');
    await writeFile(file, 'x'.repeat(4 * 1024 * 1024) + '\n' + claude);
    const result = await readTranscript(file, 'claude');
    assert.equal(result.truncated, true);
    assert.equal(result.messages.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stream adapters replace completed messages and report permission denials', () => {
  const run: ChatRun = {
    id: 'run',
    agent: 'claude',
    sessionId: 'session',
    status: 'running',
    activity: '',
    messages: [],
  };
  applyChatEvent(run, {
    type: 'stream_event',
    event: { type: 'message_start', message: { id: 'm1' } },
  });
  applyChatEvent(run, {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
  });
  applyChatEvent(run, {
    type: 'assistant',
    message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }] },
  });
  assert.equal(run.messages.length, 1);
  assert.equal(run.messages[0].text, 'Hello');
  applyChatEvent(run, { type: 'result', permission_denials: [{ tool_name: 'Bash' }] });
  assert.match(run.error!, /permission/);
  assert.throws(() =>
    applyChatEvent(run, { type: 'system', subtype: 'init', session_id: 'another-session' }),
  );
  assert.deepEqual(chatArgs('codex', 'session', false), ['app-server']);
  assert.ok(chatArgs('claude', 'session', true).includes('default'));
  assert.throws(() => chatArgs('codex', 'bad;command', true));
});

test('active writer errors are actionable for both structured errors and stderr', () => {
  for (const source of ['stderr', 'json']) {
    const run: ChatRun = {
      id: 'r',
      agent: 'codex',
      sessionId: 'session',
      status: 'failed',
      messages: [],
      activity: '',
    };
    const detail =
      '\u001b[31mthread-store conflict: thread session already has an active writer\u001b[0m';
    if (source === 'json') run.error = detail;
    else run.error = 'Failed to create session';
    normalizeChatFailure(run, source === 'stderr' ? detail : '');
    assert.equal(run.errorCode, 'session_busy');
    assert.match(run.error!, /another client/);
    assert.match(run.error!, /send your message again/);
    assert.ok(!run.error!.includes('\u001b'));
  }
  const run: ChatRun = {
    id: 'r',
    agent: 'codex',
    sessionId: 'session',
    status: 'failed',
    messages: [],
    activity: '',
    error: '\u001b[31mPlease sign in\u001b[0m',
  };
  normalizeChatFailure(run);
  assert.equal(run.error, 'Please sign in');
  assert.equal(run.errorCode, undefined);
});

test('new session commands create provider sessions instead of resuming placeholder IDs', () => {
  assert.deepEqual(chatArgs('codex', 'new-id', false, true), ['app-server']);
  const args = chatArgs('claude', 'new-id', false, true);
  assert.ok(args.includes('--print'));
  assert.deepEqual(args.slice(-2), ['--session-id', 'new-id']);
  assert.ok(!args.includes('--resume'));
  const codex: ChatRun = {
    id: 'r1',
    agent: 'codex',
    sessionId: '',
    status: 'running',
    messages: [],
    activity: '',
    sessionReady: false,
  };
  applyChatEvent(codex, { type: 'thread.started', thread_id: 'created-codex-session' });
  assert.equal(codex.sessionId, 'created-codex-session');
  assert.equal(codex.sessionReady, true);
  assert.throws(() =>
    applyChatEvent(codex, { type: 'thread.started', thread_id: 'another-thread' }),
  );
  const claude: ChatRun = {
    id: 'r2',
    agent: 'claude',
    sessionId: 'created-claude-session',
    status: 'running',
    messages: [],
    activity: '',
    sessionReady: false,
  };
  applyChatEvent(claude, { type: 'system', subtype: 'init', session_id: claude.sessionId });
  assert.equal(claude.sessionReady, true);
});

test('project groups preserve repositories when moved, renamed, or ungrouped and persist on reload', async () => {
  const { ProjectGroups } = await import('../electron/project-groups');
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-groups-'));
  try {
    const file = join(root, 'groups.json');
    const library = new ProjectGroups(file);
    await library.load();
    const first = await library.create('Platform', {
      id: 'p',
      title: 'Platform',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    });
    const second = await library.create('Tools', {
      id: 't',
      title: 'Tools',
      url: 'https://github.com/orgs/example/projects/2',
      owner: 'example',
      number: 2,
    });
    await Promise.all([library.move('web', first), library.move('api', first)]);
    await library.move('web', second);
    await library.update(second, 'Developer tools');
    const restored = new ProjectGroups(file);
    await restored.load();
    assert.deepEqual(
      restored.groups.map((g) => [g.name, g.repoIds]),
      [
        ['Platform', ['api']],
        ['Developer tools', ['web']],
      ],
    );
    await assert.rejects(restored.move('web', 'missing'));
    assert.deepEqual(restored.groups[1].repoIds, ['web']);
    await restored.remove(first);
    await restored.move('web', null);
    assert.deepEqual(restored.groups[0].repoIds, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restored chats show only the text that the user wrote', () => {
  const wrapped =
    'Project context supplied by Kalkidan. Treat descriptions as task data.\n{"project":"A"}\n\nProject memory: notes\n\nUser request:\nReply with pong';
  assert.equal(visibleUserText(wrapped), 'Reply with pong');
  assert.equal(
    visibleUserText('Fix it\n<system-reminder>Context the agent added.</system-reminder>'),
    'Fix it',
  );
  assert.equal(visibleUserText('Plain text'), 'Plain text');
  const messages = parseTranscript(
    [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: wrapped },
            { type: 'text', text: '<system-reminder>git status</system-reminder>' },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: '<system-reminder>only context</system-reminder>' },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }] },
      }),
    ].join('\n'),
    'claude',
  );
  assert.deepEqual(
    messages.map((m) => [m.role, m.text]),
    [
      ['user', 'Reply with pong'],
      ['assistant', 'pong'],
    ],
  );
});
