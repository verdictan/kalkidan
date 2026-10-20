import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

test('memory MCP binds one scope, checks the capability URL and rejects arbitrary arguments', async () => {
  let handler!: Function;
  let closed = 0;
  let received: unknown;
  const server = Object.assign(new EventEmitter(), {
    listen(_port: number, host: string, done: Function) {
      assert.equal(host, '127.0.0.1');
      done();
    },
    address: () => ({ port: 9123 }),
    close() {
      closed++;
    },
    closeIdleConnections() {},
  });
  class Memory {
    constructor(scope: unknown) {
      received = scope;
    }
    search = async (query: string) => [{ excerpt: query }];
    read = async () => ({
      id: 'entry',
      topic: 'Tests',
      revision: '1',
      provenance: 'verified',
      content: 'x'.repeat(3000),
    });
    upsert = async (value: any) => {
      if (value.content === 'fail') throw Error('Invalid candidate');
      return { status: 'saved', entry: { id: 'entry', revision: '1', content: 'private' } };
    };
  }
  const { startMemoryTools } = backendLoader({
    'node:http': {
      createServer: (callback: Function) => {
        handler = callback;
        return server;
      },
    },
    [resolve('electron/storage/managed-memory.ts')]: { ManagedMemory: Memory },
  })('electron/agents/memory-tools.ts');
  const scope = {
    root: '/bound',
    sessionId: 's',
    turnId: 't',
    sources: () => [{ id: 'user', text: 'Evidence' }],
  };
  const tools = await startMemoryTools(scope);
  assert.equal(received, scope);
  const path = new URL(tools.url).pathname;
  async function request(value: unknown, overrides: any = {}) {
    let status = 0,
      result: any;
    const body = typeof value === 'string' ? value : JSON.stringify(value);
    await handler(
      {
        url: path,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body);
        },
        ...overrides,
      },
      {
        writeHead(code: number) {
          status = code;
        },
        end(text?: string) {
          result = text ? JSON.parse(text) : undefined;
        },
      },
    );
    return { status, result };
  }
  const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal((await request(rpc('initialize'))).result.result.protocolVersion, '2025-06-18');
  assert.equal((await request(rpc('tools/list'))).result.result.tools.length, 4);
  assert.equal((await request(rpc('ping'))).status, 200);
  assert.equal(
    (await request({ jsonrpc: '2.0', method: 'notifications/initialized' })).status,
    202,
  );
  assert.equal((await request(rpc('ping'), { url: '/wrong' })).status, 403);
  assert.equal(
    (await request(rpc('ping'), { headers: { origin: 'https://attacker.example' } })).status,
    403,
  );
  assert.equal((await request(rpc('ping'), { method: 'GET' })).status, 405);
  assert.equal((await request(rpc('ping'), { headers: {} })).status, 415);
  assert.equal(
    (
      await request(rpc('ping'), {
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': 'future' },
      })
    ).status,
    400,
  );
  assert.equal((await request('x'.repeat(32001))).status, 413);
  assert.equal((await request('{')).result.error.code, -32600);
  assert.equal((await request({})).status, 400);
  assert.equal((await request(rpc('unknown'))).result.error.code, -32601);
  assert.equal(
    (
      await request(
        rpc('tools/call', { name: 'memory_search', arguments: { root: '/other', query: 'test' } }),
      )
    ).result.error.code,
    -32600,
  );
  for (const name of ['memory_search', 'memory_read', 'memory_remember', 'memory_sources']) {
    const arguments_ =
      name === 'memory_search'
        ? { query: 'test' }
        : name === 'memory_remember'
          ? { content: 'safe' }
          : {};
    const result = (await request(rpc('tools/call', { name, arguments: arguments_ }))).result
      .result;
    assert.ok(result.content[0].text.length < 2400);
    assert.equal(result.isError, undefined);
  }
  assert.equal(
    (await request(rpc('tools/call', { name: 'memory_remember', arguments: { content: 'fail' } })))
      .result.result.isError,
    true,
  );
  tools.close();
  assert.equal(closed, 1);
  assert.equal((await request(rpc('ping'))).status, 403);
});
