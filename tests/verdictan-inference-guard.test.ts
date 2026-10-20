import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { guardedRoute } from '../electron/verdictan/inference-guard';

class Reply extends PassThrough {
  headersSent = false;
  statusCode = 0;
  body = '';
  done = new Promise<void>((resolve) => this.once('finish', resolve));
  constructor() {
    super();
    this.on('data', (chunk) => {
      this.body += chunk;
    });
  }
  writeHead(code: number) {
    this.statusCode = code;
    this.headersSent = true;
    return this;
  }
}
async function fixture() {
  let handler: (request: any, reply: Reply) => void;
  const requests: { request: PassThrough; response: (response: any) => void; options: any }[] = [];
  const server = Object.assign(new EventEmitter(), {
    listen: (_port: number, _host: string, ready: () => void) => {
      ready();
    },
    address: () => ({ port: 12345 }),
    close: (done: () => void) => done(),
  });
  const module = backendLoader({
    'node:http': {
      createServer: (callback: typeof handler) => {
        handler = callback;
        return server;
      },
      request: (_url: URL, options: unknown, response: (response: unknown) => void) => {
        const request = Object.assign(new PassThrough(), { setTimeout: () => {} });
        requests.push({ request, response, options });
        return request;
      },
    },
  })(
    resolve('electron/verdictan/inference-guard.ts'),
  ) as typeof import('../electron/verdictan/inference-guard');
  const guard = await module.inferenceGuard('http://127.0.0.1:9999');
  const send = (path = '/v1/messages') => {
    const incoming = Object.assign(new PassThrough(), {
      url: path,
      method: 'POST',
      headers: { authorization: 'Bearer synthetic', connection: 'keep-alive' },
    });
    const outgoing = new Reply();
    handler(incoming, outgoing);
    incoming.end('{}');
    return outgoing;
  };
  const respond = (index: number, code: number, body: string) => {
    const response = Object.assign(new PassThrough(), {
      statusCode: code,
      headers: { 'content-type': 'text/event-stream' },
    });
    requests[index].response(response);
    response.end(body);
  };
  return { guard, module, requests, send, respond };
}

test('native inference streams pass through, but account and arbitrary paths are unavailable', async () => {
  const f = await fixture();
  try {
    const reply = f.send();
    f.respond(0, 200, 'event: start\ndata: done\n\n');
    await reply.done;
    assert.equal(reply.body, 'event: start\ndata: done\n\n');
    assert.equal(f.requests[0].options.headers.authorization, 'Bearer synthetic');
    assert.equal(f.requests[0].options.headers.connection, undefined);
    const denied = f.send('/verdictan/desktop/events');
    await denied.done;
    assert.equal(denied.statusCode, 404);
    const second = f.send('/v1/responses');
    f.respond(1, 200, 'ok');
    await second.done;
    assert.equal(f.requests.length, 2);
  } finally {
    await f.guard.close();
    await f.guard.close();
  }
});
test('terminal errors block all later native retries, including model fallback', async () => {
  const f = await fixture();
  try {
    const first = f.send();
    f.respond(0, 400, 'terminal');
    await first.done;
    assert.equal(first.statusCode, 400);
    for (let i = 0; i < 5; i++) {
      const denied = f.send();
      await denied.done;
      assert.equal(denied.statusCode, 409);
    }
    assert.equal(f.requests.length, 1);
  } finally {
    await f.guard.close();
  }
});
test('unknown transport outcome blocks replay without a new turn', async () => {
  const f = await fixture();
  try {
    const first = f.send();
    f.requests[0].request.emit('error', Error('transport lost'));
    await first.done;
    assert.equal(first.statusCode, 502);
    const denied = f.send();
    await denied.done;
    assert.equal(denied.statusCode, 409);
    assert.equal(f.requests.length, 1);
  } finally {
    await f.guard.close();
  }
});
test('guard validates its destination and rewrites only native endpoint configuration', async () => {
  const f = await fixture();
  try {
    for (const url of [
      'https://127.0.0.1:99',
      'http://localhost:99',
      'http://127.0.0.1',
      'http://user@127.0.0.1:99',
    ])
      await assert.rejects(f.module.inferenceGuard(url), /loopback_required/);
    const route = {
      args: ['-c', 'base_url="http://127.0.0.1:99/v1"'],
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:99', OPENAI_API_KEY: 'synthetic' },
    };
    const changed = guardedRoute(route, 'http://127.0.0.1:99', 'http://127.0.0.1:100');
    assert.equal(changed.args[1], 'base_url="http://127.0.0.1:100/v1"');
    assert.equal(changed.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:100');
    assert.equal(changed.env.OPENAI_API_KEY, 'synthetic');
    assert.equal(route.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:99');
  } finally {
    await f.guard.close();
  }
});
