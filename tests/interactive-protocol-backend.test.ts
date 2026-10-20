import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function fixture(agent = 'codex', platform = 'linux') {
  const writes: any[] = [],
    children: any[] = [],
    timers = new Map<any, Function>(),
    kills: any[] = [];
  let counter = 0;
  const settings = {
    handshake: true,
    wrongThread: false,
    destroyed: false,
    resolveFail: false,
    earlyApproval: false,
  };
  class Stream extends EventEmitter {
    setEncoding() {}
    destroyed = false;
    write = (line: string) => {
      const row = JSON.parse(line);
      writes.push(row);
      if (settings.handshake) {
        queueMicrotask(() => {
          if (settings.earlyApproval && row.method === 'turn/start')
            children.at(-1).stdout.emit(
              'data',
              JSON.stringify({
                id: 'early',
                method: 'item/fileChange/requestApproval',
                params: {},
              }) + '\n',
            );
          if (row.method === 'initialize' || row.method === 'turn/start')
            children.at(-1).stdout.emit('data', JSON.stringify({ id: row.id, result: {} }) + '\n');
          if (row.method?.startsWith('thread/'))
            children.at(-1).stdout.emit(
              'data',
              JSON.stringify({
                id: row.id,
                result: {
                  thread: {
                    id: settings.wrongThread
                      ? 'wrong'
                      : row.method === 'thread/resume'
                        ? row.params.threadId
                        : 'created',
                  },
                },
              }) + '\n',
            );
          if (row.type === 'control_request')
            children.at(-1).stdout.emit(
              'data',
              JSON.stringify({
                type: 'control_response',
                response: { request_id: row.request_id, subtype: 'success', response: {} },
              }) + '\n',
            );
        });
      }
      return true;
    };
    end() {}
  }
  const { InteractiveChatRunner } = backendLoader(
    {
      [resolve('electron/core.ts')]: {
        exec: () => {
          throw Error('Unexpected executable lookup');
        },
      },
      'node:child_process': {
        spawn: () => {
          const child = Object.assign(new EventEmitter(), {
            stdin: new Stream(),
            stdout: new Stream(),
            stderr: new Stream(),
            pid: 42,
            kill: (signal: string) => kills.push(signal),
          });
          child.stdin.destroyed = settings.destroyed;
          children.push(child);
          return child;
        },
      },
      'node:crypto': { randomUUID: () => String(++counter) },
    },
    {
      process: { platform, kill: (pid: number, signal: string) => kills.push([pid, signal]) },
      setTimeout: (fn: Function) => {
        const id = { unref() {} };
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id: any) => timers.delete(id),
    },
  )(resolve('electron/interactive-chat.ts'));
  const runner = new InteractiveChatRunner(
    async () => {
      if (settings.resolveFail) throw Error('missing binary');
      return { path: '/fixture', env: {} };
    },
    { agentRequestTimeoutMs: 10 },
  );
  const session = { id: 'session', agent, cwd: '/repo', title: 'Test', updatedAt: '' };
  return {
    runner,
    session,
    writes,
    children,
    timers,
    kills,
    settings,
    emit: (row: any) => children.at(-1).stdout.emit('data', JSON.stringify(row) + '\n'),
  };
}

test('Codex protocol handles typed tool events, approvals, cancellation and bounded messages deterministically', async () => {
  const f = fixture(),
    r = await f.runner.start(f.session, 'task', true);
  await drain();
  assert.equal(r.sessionReady, true);
  assert.equal(f.runner.runningCount(), 1);
  f.children[0].stdout.emit('data', 'invalid\n');
  f.children[0].stdin.emit('error', Error('closed'));
  f.emit({ id: 'unknown', result: {} });
  f.emit({
    method: 'item/agentMessage/delta',
    params: { threadId: 'other', itemId: 'msg', delta: 'ignore' },
  });
  assert.equal(r.messages.length, 0);
  f.emit({ id: 90, method: 'unsupported', params: {} });
  assert.equal(f.writes.at(-1).error.code, -32601);
  for (const type of ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'agentMessage'])
    for (const method of ['item/started', 'item/completed'])
      f.emit({
        method,
        params: {
          item: {
            id: type,
            type,
            text: 'message',
            changes: [{ path: 'a', diff: '+line' }, { path: 'b' }],
            query: 'query',
          },
        },
      });
  f.emit({
    method: 'item/commandExecution/outputDelta',
    params: { itemId: 'commandExecution', delta: 'output' },
  });
  f.emit({
    method: 'item/commandExecution/outputDelta',
    params: { itemId: 'missing', delta: 'ignore' },
  });
  f.emit({ method: 'item/agentMessage/delta', params: { itemId: 'agentMessage', delta: 'more' } });
  f.emit({ method: 'item/agentMessage/delta', params: { itemId: 'agentMessage', delta: '' } });
  f.emit({ method: 'turn/diff/updated', params: { diff: 'x'.repeat(128001) } });
  assert.match(r.diff, /Earlier output omitted/);
  for (const [id, method] of [
    ['1', 'item/commandExecution/requestApproval'],
    ['2', 'item/fileChange/requestApproval'],
    ['3', 'item/permissions/requestApproval'],
  ])
    f.emit({
      id,
      method,
      params: {
        itemId: 'fileChange',
        command: 'command',
        cwd: '/repo',
        reason: 'reason',
        grantRoot: '/repo',
        networkApprovalContext: { host: 'test' },
        permissions: { read: true },
      },
    });
  f.emit({ id: '1', method: 'item/commandExecution/requestApproval', params: {} });
  assert.equal(r.approvals.length, 3);
  f.runner.approve(r.id, '1', true);
  f.runner.approve(r.id, '2', false);
  f.runner.approve(r.id, '3', true);
  assert.deepEqual(f.writes.at(-1).result, { permissions: { read: true }, scope: 'turn' });
  f.emit({
    id: '4',
    method: 'item/permissions/requestApproval',
    params: { additionalPermissions: { write: true } },
  });
  f.runner.approve(r.id, '4', false);
  assert.deepEqual(f.writes.at(-1).result.permissions, {});
  f.emit({ id: '5', method: 'item/fileChange/requestApproval', params: {} });
  f.emit({ method: 'serverRequest/resolved', params: { requestId: '5' } });
  assert.equal(r.approvals.at(-1).status, 'expired');
  f.emit({ method: 'serverRequest/resolved', params: { requestId: 'missing' } });
  f.emit({ method: 'error', params: { willRetry: true } });
  assert.equal(r.error, undefined);
  f.emit({ method: 'turn/completed', params: { turn: { status: 'interrupted' } } });
  assert.equal(r.status, 'stopped');
  for (const fn of [...f.timers.values()]) fn();
  assert.ok(f.kills.some((k: any) => k[1] === 'SIGKILL'));
  f.children[0].emit('close');
  f.runner.dispose();
});

test('Claude protocol handles streaming, subagents, tool results and explicit permission replies', async () => {
  const f = fixture('claude', 'win32'),
    r = await f.runner.start(f.session, 'task', false, true, 'model', 'source');
  await drain();
  assert.equal(r.sessionId, '');
  f.emit({ type: 'system', subtype: 'init', session_id: 'fork' });
  f.emit({ type: 'control_request', request_id: 'unsupported', request: { subtype: 'other' } });
  assert.equal(f.writes.at(-1).response.subtype, 'error');
  f.emit({
    type: 'assistant',
    parent_tool_use_id: 'child',
    message: { content: [{ type: 'text', text: 'hidden' }] },
  });
  assert.equal(r.messages.length, 0);
  f.emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'message' } } });
  f.emit({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'Hello' } } });
  f.emit({ type: 'stream_event', event: { delta: { type: 'text_delta', text: ' world' } } });
  assert.equal(r.messages[0].text, 'Hello world');
  for (const name of ['Edit', 'Write', 'Bash'])
    f.emit({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: name,
            name,
            input: {
              file_path: 'a',
              old_string: 'before',
              new_string: 'after',
              content: 'content',
            },
          },
        ],
      },
    });
  for (const name of ['Edit', 'Write', 'missing'])
    f.emit({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: name, content: 'result', is_error: name === 'Edit' },
        ],
      },
    });
  assert.equal(r.tools[0].status, 'failed');
  assert.equal(r.tools[1].status, 'completed');
  for (const [id, allow] of [
    ['yes', true],
    ['no', false],
  ] as const) {
    f.emit({
      type: 'control_request',
      request_id: id,
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'echo' } },
    });
    f.runner.approve(r.id, id, allow);
    assert.equal(f.writes.at(-1).response.response.behavior, allow ? 'allow' : 'deny');
  }
  f.emit({
    type: 'control_request',
    request_id: 'cancel',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} },
  });
  f.emit({ type: 'control_cancel_request', request_id: 'cancel' });
  assert.equal(r.approvals.at(-1).status, 'expired');
  f.emit({ type: 'result', is_error: true, errors: ['failure'] });
  assert.equal(r.status, 'failed');
  f.runner.dispose();
  assert.ok(f.kills.includes('SIGKILL'));
  f.children[0].emit('close');
});

test('startup failures, output limits, identity violations and request deadlines settle without wall-clock waits', async () => {
  for (const mode of [
    'timeout',
    'wrongThread',
    'destroyed',
    'resolveFail',
    'error',
    'close',
    'oversize',
    'tooManyApprovals',
    'largeApproval',
    'turnError',
  ]) {
    const f = fixture();
    if (mode === 'timeout') f.settings.handshake = false;
    if (mode === 'wrongThread') f.settings.wrongThread = true;
    if (mode === 'destroyed') f.settings.destroyed = true;
    if (mode === 'resolveFail') f.settings.resolveFail = true;
    const r = await f.runner.start(f.session, 'task', true);
    await drain();
    if (mode === 'timeout') {
      for (const fn of [...f.timers.values()]) fn();
      await drain();
    }
    if (mode === 'error') f.children[0].emit('error', Error('spawn failed'));
    if (mode === 'close') {
      f.children[0].stderr.emit('data', 'agent crashed');
      f.children[0].stdout.emit('data', '{}');
      f.children[0].emit('close');
    }
    if (mode === 'oversize') f.children[0].stdout.emit('data', 'x'.repeat(8 * 1024 * 1024 + 1));
    if (mode === 'tooManyApprovals')
      for (let i = 0; i < 51; i++)
        f.emit({ id: i, method: 'item/commandExecution/requestApproval', params: {} });
    if (mode === 'largeApproval')
      f.emit({
        id: 1,
        method: 'item/commandExecution/requestApproval',
        params: { reason: 'x'.repeat(128001) },
      });
    if (mode === 'turnError')
      f.emit({
        method: 'turn/completed',
        params: { turn: { error: { message: 'turn error' }, status: 'failed' } },
      });
    assert.equal(r.status, 'failed', mode);
    assert.ok(r.error, mode);
    f.runner.dispose();
  }
  const f = fixture();
  for (const args of [
    [{ ...f.session, id: 'bad space' }, 'task', true],
    [f.session, '', true],
    [f.session, 'task', 'yes'],
    [f.session, 'task', true, false, 'bad model'],
    [f.session, 'task', true, false, undefined, 'source'],
  ])
    await assert.rejects(f.runner.start(...args));
  const r = await f.runner.start(f.session, 'task', true);
  await drain();
  await assert.rejects(f.runner.start(f.session, 'again', true), /in progress/);
  f.runner.stopAll();
  assert.equal(r.status, 'stopped');
  f.runner.stop('missing');
  f.runner.dispose();
});

test('pending handshakes close cleanly and resumed turns wait for the old process', async () => {
  for (const agent of ['codex', 'claude']) {
    const f = fixture(agent);
    f.settings.handshake = false;
    const run = await f.runner.start(f.session, 'task', true);
    await drain();
    assert.equal(f.runner.status(run.id), run);
    assert.throws(() => f.runner.status('missing'), /no longer available/);
    if (agent === 'claude') {
      f.emit({
        type: 'control_response',
        response: {
          request_id: f.writes[0].request_id,
          subtype: 'error',
          error: 'initialization refused',
        },
      });
      await drain();
      assert.equal(run.error, 'initialization refused');
    } else {
      f.children[0].emit('close');
      await drain();
      assert.equal(run.status, 'failed');
      assert.match(run.error, /Agent exited before completing/);
    }
    assert.equal(f.timers.size <= 1, true);
    f.runner.dispose();
  }
  const f = fixture();
  const first = await f.runner.start(f.session, 'one', true);
  await drain();
  f.emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  assert.equal(first.status, 'completed');
  const next = await f.runner.start(f.session, 'two', true);
  await drain();
  assert.equal(f.children.length, 1);
  f.children[0].emit('close');
  await drain();
  assert.equal(f.children.length, 2);
  assert.equal(next.sessionReady, true);
  f.runner.dispose();
});

test('agent protocols bound retained state and tolerate sparse events', async () => {
  const f = fixture();
  f.settings.earlyApproval = true;
  const run = await f.runner.start(f.session, 'fork', false, true, 'model', 'source');
  await drain();
  assert.equal(run.activity, 'Waiting for your approval');
  assert.ok(f.writes.some((r) => r.method === 'thread/fork' && r.params.threadId === 'source'));
  f.runner.approve(run.id, 'early', true);
  for (let i = 0; i < 205; i++) {
    f.emit({ id: i, method: 'item/fileChange/requestApproval', params: {} });
    f.runner.approve(run.id, String(i), false);
  }
  assert.ok(run.approvals.length < 200);
  for (let i = 0; i < 210; i++)
    f.emit({
      method: 'item/started',
      params: { item: { id: String(i), type: 'commandExecution' } },
    });
  assert.equal(run.tools.length, 200);
  for (let i = 0; i < 1005; i++)
    f.emit({ method: 'item/agentMessage/delta', params: { itemId: String(i), delta: 'text' } });
  assert.equal(run.messages.length, 1000);
  f.emit({ method: 'item/commandExecution/outputDelta', params: { itemId: '1', delta: 'out' } });
  f.emit({ id: 'tool', method: 'item/commandExecution/requestApproval', params: { itemId: '1' } });
  f.emit({ method: 'error', params: {} });
  assert.equal(run.error, 'Codex reported an error.');
  f.emit({ method: 'turn/completed', params: {} });
  f.children[0].emit('close');
  f.settings.earlyApproval = false;
  for (let i = 0; i < 32; i++) {
    await f.runner.start(f.session, 'again', false);
    await drain();
    f.emit({ method: 'turn/completed', params: {} });
    f.children.at(-1).emit('close');
  }
  assert.throws(() => f.runner.status(run.id), /no longer available/);
  f.runner.dispose();
  const c = fixture('claude');
  const claude = await c.runner.start(c.session, 'task', false);
  await drain();
  c.emit({ type: 'stream_event', event: { type: 'message_start' } });
  c.emit({ type: 'assistant' });
  c.emit({
    type: 'assistant',
    message: { content: ['Edit', 'Write'].map((name) => ({ type: 'tool_use', name, id: name })) },
  });
  c.emit({ type: 'result' });
  assert.equal(claude.status, 'completed');
  c.runner.dispose();
});
