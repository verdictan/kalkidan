import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagedGateway, codexProviders } from '../electron/verdictan/gateway';
import type { RuntimeCredentials } from '../electron/verdictan/credentials';

const id = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-10-20T00:00:00Z');
const credentials: RuntimeCredentials = {
  schema_version: 1,
  correlation_id: 'export',
  runtime_id: id,
  runtime_registration_id: id,
  session_id: id,
  agent_id: id,
  gateway_id: 'gateway',
  api_url: 'https://api.verdictan.com',
  expires_at: '2026-10-20T00:10:00Z',
  generation: 3,
  runtime_credential: 'vdt_' + 'a'.repeat(20),
  inference_credential: 'vdt_' + 'b'.repeat(20),
};
const agent = { kind: 'codex' as const, version: '0.162.0-alpha.17.2' };
const turn = {
  hostId: id,
  projectId: 'project',
  taskId: 'task',
  conversationId: 'conversation',
  runId: 'run',
  turnId: 'turn',
};
const ready = {
  schema_version: 1,
  ready: true,
  dispatch_authorized: false,
  runtime_id: id,
  session_id: id,
  credential: 'ready',
  dependencies: 'ready',
  protocol_acceptance: 'verified',
  control_plane: { runtime_id: id, session_id: id, generation: 3, ready: true },
};
/** The route of a ready gateway in the supervisor, for one access mode. */
async function route(mode?: RuntimeCredentials['provider_access_mode']) {
  const gateway = new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials: { ...credentials, ...(mode ? { provider_access_mode: mode } : {}) },
    now: () => now,
    instance: { address: 'http://127.0.0.1:43123', subscribe: () => () => {} },
    request: (async () => Response.json(ready)) as any,
  });
  try {
    return await gateway.nativeRoute(agent, turn);
  } finally {
    await gateway.stop();
  }
}
const headers =
  '{"x-verdictan-desktop-runtime-id"="11111111-1111-4111-8111-111111111111",' +
  '"x-verdictan-desktop-session-id"="11111111-1111-4111-8111-111111111111",' +
  '"x-verdictan-desktop-host-id"="11111111-1111-4111-8111-111111111111",' +
  '"x-verdictan-desktop-project-id"="project","x-verdictan-desktop-task-id"="task",' +
  '"x-verdictan-desktop-run-id"="run","x-verdictan-desktop-conversation-id"="conversation",' +
  '"x-verdictan-desktop-turn-id"="turn","x-verdictan-desktop-agent-kind"="codex",' +
  '"x-verdictan-desktop-agent-version"="0.162.0-alpha.17.2"}';

test('a Codex subscription route defines and names the subscription provider', async () => {
  const value = await route('codex_subscription');
  assert.equal(value.modelProvider, codexProviders.codex_subscription);
  assert.deepEqual(value.args, [
    '-c',
    'model_provider="verdictan_subscription"',
    '-c',
    'features.apps=false',
    '-c',
    'model_providers.verdictan_subscription={name="Verdictan subscription",' +
      'base_url="http://127.0.0.1:43123/backend-api/codex",wire_api="responses",' +
      'requires_openai_auth=true,supports_websockets=false,request_max_retries=0,' +
      `stream_max_retries=0,http_headers=${headers},` +
      'env_http_headers={"X-Gateway-Key"="KALKIDAN_INFERENCE_CREDENTIAL"}}',
  ]);
  assert.deepEqual(value.env, { KALKIDAN_INFERENCE_CREDENTIAL: credentials.inference_credential });
});

test('an API key route defines and names the API key provider', async () => {
  for (const mode of [undefined, 'byok'] as const) {
    const value = await route(mode);
    assert.equal(value.modelProvider, codexProviders.byok);
    assert.deepEqual(value.args, [
      '-c',
      'model_provider="verdictan"',
      '-c',
      'model_providers.verdictan={name="Verdictan",base_url="http://127.0.0.1:43123/v1",' +
        'env_key="OPENAI_API_KEY",wire_api="responses",request_max_retries=0,' +
        `stream_max_retries=0,http_headers=${headers}}`,
    ]);
    assert.deepEqual(value.env, { OPENAI_API_KEY: credentials.inference_credential });
  }
});
