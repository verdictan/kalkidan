import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

test('history scans handle inaccessible indexes, stat failures, unreadable streams, malformed lines and vanished roots', async () => {
  for (const mode of ['index', 'permissions', 'stat', 'stream', 'invalid', 'fallback', 'missing']) {
    let destroyed = 0;
    const { history } = backendLoader({
      [resolve('electron/codex-store.ts')]: {
        codexIndex: async () => {
          if (mode === 'index') throw Error('index corrupt');
          return [];
        },
      },
      'node:fs/promises': {
        readdir: async () => {
          if (['permissions', 'missing'].includes(mode))
            throw Object.assign(Error('unavailable'), {
              code: mode === 'missing' ? 'ENOENT' : 'EACCES',
            });
          return [{ name: 'session.jsonl', isDirectory: () => false, isFile: () => true }];
        },
        stat: async () => {
          if (mode === 'stat') throw Error('stat failed');
          return { dev: 1, ino: 1, size: 100, mtimeMs: 1000, ctimeMs: 1000 };
        },
        realpath: async () => {
          throw Error('missing cwd');
        },
      },
      'node:fs': { createReadStream: (path: string) => ({ path, destroy: () => destroyed++ }) },
      'node:readline': {
        createInterface: ({ input }: any) => ({
          async *[Symbol.asyncIterator]() {
            if (mode === 'stream') throw Error('unreadable');
            yield 'bad JSON';
            if (input.path.includes('codex'))
              yield JSON.stringify({
                type: 'session_meta',
                payload: { cwd: '/repo', id: 'codex' },
              });
            else
              yield JSON.stringify({
                type: 'user',
                cwd: '/repo',
                sessionId: 'claude',
                message: { content: mode === 'fallback' ? [] : 'Task' },
              });
          },
        }),
      },
    })(resolve('electron/history.ts'));
    const result = await history('/codex', '/claude');
    if (['index', 'permissions', 'stat', 'stream'].includes(mode))
      assert.ok(result.warnings.length > 0, mode);
    if (mode === 'fallback')
      assert.ok(result.sessions.every((s: any) => s.title === 'Agent session'));
    if (mode === 'missing') assert.deepEqual(result.sessions, []);
    if (!['permissions', 'missing', 'stat'].includes(mode)) assert.equal(destroyed, 2);
  }
});

test('Codex SQL transcript omits empty and non-text payloads while always closing the database', async () => {
  let closed = 0;
  const { codexTranscript } = backendLoader({
    'node:fs/promises': { readdir: async () => ['thread_history_1.sqlite'] },
    'node:sqlite': {
      DatabaseSync: class {
        prepare() {
          return {
            all: () => [
              { item_json: JSON.stringify({ type: 'agentMessage', text: '' }) },
              { item_json: JSON.stringify({ type: 'agentMessage', text: 12 }) },
            ],
          };
        }
        close() {
          closed++;
        }
      },
    },
  })(resolve('electron/codex-store.ts'));
  assert.deepEqual(await codexTranscript('/fixture', 'session'), {
    messages: [],
    truncated: false,
  });
  assert.equal(closed, 1);
});
