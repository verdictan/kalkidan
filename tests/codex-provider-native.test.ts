import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { agentPrograms } from '../electron/chat';
import { installedAgentVersion } from '../electron/agents/installed-version';
import { checkAgentVersion } from '../src/domain/agent-version';
import { ManagedGateway } from '../electron/verdictan/gateway';
import { prepareSubscriptionAuth } from '../electron/verdictan/subscription-auth';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Runs the real Codex app-server with the managed arguments, when this computer has a supported
 * Codex. KALKIDAN_CODEX_PATH selects a program. The check makes no network request: it only
 * starts an ephemeral thread in an empty Codex home.
 */
async function codex() {
  const programs = await agentPrograms('codex').catch(() => undefined);
  const program = programs?.selected;
  if (!program) return undefined;
  const version = await installedAgentVersion('codex', program).catch(() => undefined);
  return checkAgentVersion('codex', version).status === 'supported' ? program : undefined;
}

const id = '11111111-1111-4111-8111-111111111111';
async function managedArgs(mode: 'byok' | 'codex_subscription', address = 'http://127.0.0.1:9') {
  const gateway = new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials: {
      schema_version: 1,
      correlation_id: 'export',
      runtime_id: id,
      runtime_registration_id: id,
      session_id: id,
      agent_id: id,
      gateway_id: 'gateway',
      api_url: 'https://api.verdictan.com',
      expires_at: new Date(Date.now() + 600000).toISOString(),
      generation: 1,
      runtime_credential: 'vdt_' + 'a'.repeat(20),
      inference_credential: 'vdt_' + 'b'.repeat(20),
      provider_access_mode: mode,
    },
    instance: { address, subscribe: () => () => {} },
    request: (async () =>
      Response.json({
        schema_version: 1,
        ready: true,
        dispatch_authorized: false,
        runtime_id: id,
        session_id: id,
        credential: 'ready',
        dependencies: 'ready',
        protocol_acceptance: 'verified',
        control_plane: { runtime_id: id, session_id: id, generation: 1, ready: true },
      })) as any,
  });
  try {
    return await gateway.nativeRoute(
      { kind: 'codex', version: '0.162.0' },
      {
        hostId: id,
        projectId: 'project',
        taskId: 'task',
        conversationId: 'conversation',
        runId: 'run',
        turnId: 'turn',
      },
    );
  } finally {
    await gateway.stop();
  }
}

/** Starts one ephemeral thread and returns the error message of `thread/start`, if any. */
async function threadStart(path: string, args: string[], home: string, provider?: string) {
  const child = spawn(path, ['app-server', ...args], {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout! });
  const replies = new Map<number, (value: any) => void>();
  lines.on('line', (line) => {
    try {
      const row = JSON.parse(line);
      replies.get(row.id)?.(row);
    } catch {
      /* Not a protocol line. */
    }
  });
  const call = (id: number, method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30000);
      replies.set(id, (row) => {
        clearTimeout(timer);
        resolve(row);
      });
      child.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
    });
  try {
    await call(1, 'initialize', {
      clientInfo: { name: 'kalkidan-test', title: 't', version: '0' },
    });
    child.stdin!.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const reply = await call(2, 'thread/start', {
      cwd: home,
      ephemeral: true,
      sandbox: 'danger-full-access',
      approvalPolicy: 'on-request',
      ...(provider ? { modelProvider: provider } : {}),
    });
    return reply.error?.message as string | undefined;
  } finally {
    child.kill();
  }
}

test('the real Codex accepts the managed provider of each access mode', async (t) => {
  const program = await codex();
  if (!program) return t.skip('No supported Codex on this computer.');
  const home = await mkdtemp(join(tmpdir(), 'kalkidan-codex-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const mode of ['byok', 'codex_subscription'] as const) {
    const route = await managedArgs(mode);
    assert.equal(await threadStart(program.path, route.args, home, route.modelProvider), undefined);
  }
  // The defect: a subscription launch that names the API key provider.
  const subscription = await managedArgs('codex_subscription');
  assert.match(
    (await threadStart(program.path, subscription.args, home, 'verdictan')) || '',
    /Model provider `verdictan` not found/,
  );
});

/** A synthetic ChatGPT login. Codex reads the account from the ID token claims. */
function syntheticLogin() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    part({ alg: 'none', typ: 'JWT' }),
    part({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test', chatgpt_plan_type: 'plus' },
    }),
    'signature',
  ].join('.');
  return { accessToken: token, accountId: 'acct-test', idToken: token };
}

test('the real Codex sends the subscription and gateway headers with the managed login', async (t) => {
  const program = await codex();
  if (!program) return t.skip('No supported Codex on this computer.');
  const home = await mkdtemp(join(tmpdir(), 'kalkidan-codex-home-'));
  const requests: { path: string; headers: IncomingHttpHeaders }[] = [];
  // A fake gateway on loopback. It records each request and refuses it.
  const server = createServer((request, response) => {
    requests.push({ path: request.url || '', headers: request.headers });
    request.resume();
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"error":{"code":"desktop.test","message":"refused"}}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    await rm(home, { recursive: true, force: true });
  });
  const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prepareSubscriptionAuth(home, syntheticLogin());
  const route = await managedArgs('codex_subscription', address);
  const child = spawn(program.path, ['app-server', ...route.args], {
    env: { ...process.env, ...route.env, CODEX_HOME: home },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout! });
  const replies = new Map<number, (value: any) => void>();
  lines.on('line', (line) => {
    try {
      const row = JSON.parse(line);
      replies.get(row.id)?.(row);
    } catch {
      /* Not a protocol line. */
    }
  });
  const call = (id: number, method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      replies.set(id, resolve);
      child.stdin!.write(JSON.stringify({ id, method, params }) + '\n');
    });
  await call(1, 'initialize', { clientInfo: { name: 'kalkidan-test', title: 't', version: '0' } });
  child.stdin!.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const thread = await call(2, 'thread/start', {
    cwd: home,
    ephemeral: true,
    sandbox: 'danger-full-access',
    approvalPolicy: 'on-request',
    modelProvider: route.modelProvider,
    model: 'gpt-test',
  });
  await call(3, 'turn/start', {
    threadId: thread.result.thread.id,
    input: [{ type: 'text', text: 'hi' }],
  });
  const end = Date.now() + 30000;
  while (!requests.some((r) => r.path.includes('/responses')) && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const responses = requests.find((r) => r.path.includes('/backend-api/codex/responses'));
  assert.ok(responses, 'Codex sent no responses request');
  // The gateway refuses a request without all three headers (401 "Codex subscription and
  // gateway authentication are required").
  assert.match(String(responses.headers.authorization), /^Bearer eyJ/);
  assert.equal(responses.headers['chatgpt-account-id'], 'acct-test');
  assert.match(String(responses.headers['x-gateway-key']), /^vdt_/);
});
