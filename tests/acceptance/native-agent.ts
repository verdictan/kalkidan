import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { InteractiveChatRunner } from '../../electron/interactive-chat';
import { prepareIsolation } from '../../electron/verdictan/isolation';
import { inferenceGuard } from '../../electron/verdictan/inference-guard';
import type { Session, ChatRun } from '../../src/domain/conversation';
// The fixture speaks the native provider protocols, not a substitute agent protocol.
// @ts-expect-error JavaScript fixture shared with native protocol probes.
import { responseEvents, hasToolResult } from './provider-fixture.mjs';

const versions = { codex: '0.163.0-alpha.10.2', claude: '2.1.304' };
async function main() {
  const [agent, binary, mode = 'complete'] = process.argv.slice(2);
  assert.ok(agent === 'codex' || agent === 'claude');
  assert.ok(
    binary && ['complete', 'tool', 'cancel', 'error', 'partial', 'resume', 'fork'].includes(mode),
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kalkidan-native-')));
  const home = join(root, 'home'),
    cwd = join(root, 'project');
  await mkdir(home);
  await mkdir(cwd);
  let requests = 0,
    toolResult = false,
    closed = false;
  const failures: string[] = [],
    releases: Promise<void>[] = [];
  const observed: { model: string; tools: string[]; results: unknown[] }[] = [];
  const server = createServer(async (request, response) => {
    try {
      const path = request.url?.split('?')[0];
      if (request.method !== 'POST' || !['/v1/responses', '/v1/messages'].includes(path || '')) {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      assert.ok(
        request.headers.authorization === 'Bearer fixture-key' ||
          request.headers['x-api-key'] === 'fixture-key',
      );
      let bytes = '';
      for await (const chunk of request) {
        bytes += chunk;
        assert.ok(bytes.length <= 2_000_000);
      }
      const body = JSON.parse(bytes);
      observed.push({
        model: body.model,
        tools: (body.tools || []).map((tool: any) => tool.name),
        results: (body.input || []).filter((item: any) => item.type === 'function_call_output'),
      });
      assert.equal(body.stream, true);
      assert.ok(++requests <= 6, 'Unexpected native retry');
      const family = agent === 'codex' ? 'responses' : 'messages';
      toolResult ||= hasToolResult(body, family);
      if (mode === 'error') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: {
              type: 'invalid_request_error',
              code: 'fixture_invalid_request',
              message: 'fixture-invalid-request',
            },
          }),
        );
        return;
      }
      if (mode === 'cancel') {
        response.on('close', () => {
          closed = true;
        });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const tools = (body.tools || []).flatMap((tool: any) =>
        tool.type === 'namespace'
          ? tool.tools.map((child: any) => ({ ...child, namespace: tool.name }))
          : [tool],
      );
      const tool = tools.find((tool: any) =>
        ['Bash', 'shell_command', 'exec_command'].includes(tool.name),
      );
      const selected = tool && {
        name: tool.name,
        ...(tool.namespace ? { namespace: tool.namespace } : {}),
        args:
          tool.name === 'exec_command'
            ? { cmd: 'printf verdictan-fixture' }
            : { command: 'printf verdictan-fixture' },
      };
      const events = responseEvents(body, family, mode !== 'tool' || toolResult, selected).map(
        (event: any) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
      if (mode === 'partial') {
        response.write(events[0]);
        setImmediate(() => response.destroy());
      } else response.end(events.join(''));
    } catch (error) {
      failures.push(String(error));
      response.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const model = agent === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4-6';
  const runner = new InteractiveChatRunner(
    async () => ({ path: binary, env: {} }),
    { defaultTracker: 'github', agentRequestTimeoutMs: 15000, agentExecutable: {} },
    false,
    async (request) => {
      const guard = await inferenceGuard(endpoint);
      let isolation: Awaited<ReturnType<typeof prepareIsolation>>;
      try {
        isolation = await prepareIsolation(request, home, guard.address);
      } catch (error) {
        await guard.close();
        throw error;
      }
      assert.equal(isolation.version, versions[agent]);
      let release: Promise<void> | undefined;
      return {
        ...isolation,
        model,
        args:
          agent === 'codex'
            ? [
                '-c',
                'model_provider="verdictan"',
                '-c',
                `model_providers.verdictan={name="Acceptance",base_url="${guard.address}/v1",env_key="OPENAI_API_KEY",wire_api="responses",request_max_retries=0,stream_max_retries=0}`,
              ]
            : [],
        env: {
          ...isolation.env,
          ...(agent === 'codex'
            ? { OPENAI_API_KEY: 'fixture-key' }
            : { ANTHROPIC_BASE_URL: guard.address, ANTHROPIC_API_KEY: 'fixture-key' }),
        },
        bindNativeSession: async () => {},
        redact: (text) => text.replaceAll('fixture-key', '[redacted]'),
        finish: () => {
          if (!release) {
            release = guard.close().then(() => isolation.close());
            releases.push(release);
          }
          return release;
        },
      };
    },
  );
  const session: Session = {
    id: randomUUID(),
    agent,
    cwd,
    title: 'Native acceptance',
    updatedAt: new Date().toISOString(),
  };
  const wait = async (initial: ChatRun) => {
    let state = initial;
    const deadline = Date.now() + 60000;
    while (state.status === 'running' && Date.now() < deadline) {
      for (const approval of state.approvals || [])
        if (approval.status === 'pending') runner.approve(state.id, approval.id, true);
      if (mode === 'cancel' && requests > 0) runner.stop(state.id);
      await delay(50);
      state = runner.status(state.id);
    }
    assert.notEqual(state.status, 'running', 'Native turn exceeded deadline');
    return state;
  };
  try {
    let state = await wait(
      await runner.start(session, 'Return Fixture complete.', true, true, model),
    );
    assert.equal(
      state.status,
      mode === 'cancel' ? 'stopped' : ['error', 'partial'].includes(mode) ? 'failed' : 'completed',
      state.error || 'Native turn did not finish',
    );
    if (mode === 'resume' || mode === 'fork') {
      assert.ok(state.sessionReady && state.sessionId);
      const originalId = state.sessionId;
      // Wait for the per-turn native writer to close before opening the same thread.
      await delay(2500);
      state = await wait(
        await runner.start(
          { ...session, id: mode === 'fork' ? randomUUID() : originalId },
          'Continue.',
          true,
          mode === 'fork',
          model,
          mode === 'fork' ? originalId : undefined,
        ),
      );
      assert.equal(state.status, 'completed', state.error || 'Native resume failed');
      if (mode === 'fork') assert.notEqual(state.sessionId, originalId);
      else assert.equal(state.sessionId, originalId);
    }
    if (mode === 'tool') assert.equal(toolResult, true);
    if (['error', 'partial'].includes(mode))
      assert.equal(requests, 1, 'Failed requests must not replay');
    if (mode === 'cancel') {
      await delay(500);
      assert.equal(closed, true);
      assert.equal(requests, 1);
    } else if (!['error', 'partial'].includes(mode))
      assert.ok(state.messages.some((message) => message.text.includes('Fixture complete.')));
    assert.deepEqual(failures, []);
    console.log(
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        agent,
        version: versions[agent],
        mode,
        requests,
        status: 'passed',
        scope: 'native-adapter-and-isolation',
        syntheticProvider: true,
      }),
    );
  } catch (error) {
    console.error(JSON.stringify({ failures, observed }));
    throw error;
  } finally {
    runner.dispose();
    await delay(2500);
    await Promise.all(releases);
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
