import { spawn } from 'node:child_process';
import { ManagedGateway } from '../../electron/verdictan/gateway';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopProtocol } from '../../electron/verdictan/protocol';
import { BindingStore } from '../../electron/verdictan/bindings';
import { VerdictanSetupService } from '../../electron/verdictan/setup';
import { ManagedRuntimes } from '../../electron/verdictan/runtime';
import { VerdictanLaunchService } from '../../electron/verdictan/launch';
import { InteractiveChatRunner } from '../../electron/interactive-chat';
import policy from '../../electron/verdictan/runtime-policy.json';
import { runtimePolicyForHost, type RuntimePolicy } from '../../electron/verdictan/install';

async function main() {
  const [runtime, binary, policyIndex = '0'] = process.argv.slice(2);
  assert.ok(runtime && binary, 'Supply the approved runtime and native Codex executable.');
  const approval = runtimePolicyForHost(policy as RuntimePolicy, process.platform, process.arch);
  const manifest = JSON.parse(approval.manifest);
  // The installer verifies archive approval. Acceptance also binds the executable to that manifest.
  assert.equal(
    createHash('sha256').update(approval.manifest).digest('hex'),
    approval.pin.manifest_sha256,
  );
  const artifact = manifest.artifacts.find(
    (a: any) => a.os === process.platform && a.arch === process.arch,
  );
  assert.ok(artifact?.executable_sha256, 'The approval must identify the executable.');
  assert.equal(
    createHash('sha256')
      .update(await readFile(runtime))
      .digest('hex'),
    artifact.executable_sha256,
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kalkidan-managed-live-')));
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const client = new DesktopProtocol(runtime, [
    '--desktop-version',
    '0.1.0',
    '--api-url',
    'https://api.eu.verdictan.com',
    '--console-url',
    'https://console.eu.verdictan.com',
    '--profile',
    'kalkidan-eu',
  ]);
  const originalRequest = client.request.bind(client);
  client.request = async (...args) => {
    try {
      return await originalRequest(...args);
    } catch (error: any) {
      console.error(`Broker operation ${args[0]} failed: ${error.code || 'transport'}`);
      throw error;
    }
  };
  const bindings = new BindingStore(root);
  const setup = new VerdictanSetupService(
    async () => client,
    bindings,
    'https://api.eu.verdictan.com',
  );
  const managed = new ManagedRuntimes({
    apiOrigin: 'https://api.eu.verdictan.com',
    client: async () => client,
    executable: async () => runtime,
    gateway: (options) =>
      new ManagedGateway({
        ...options,
        launch: ((...args: Parameters<typeof spawn>) => {
          const child = spawn(...args);
          let buffer = '';
          child.stdout?.on('data', (chunk) => {
            buffer += chunk.toString();
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              try {
                const event = JSON.parse(line);
                if (event.event === 'error')
                  console.error(
                    'Gateway code:',
                    /^[a-z_.]+$/.test(event.data?.code) ? event.data.code : 'unavailable',
                  );
              } catch {}
            }
          });
          return child;
        }) as typeof spawn,
      }),
  });
  const launch = new VerdictanLaunchService(bindings, setup, managed, 'local-acceptance');
  const runner = new InteractiveChatRunner(
    async () => ({ path: binary, env: {} }),
    { defaultTracker: 'github', agentRequestTimeoutMs: 30000, agentExecutable: {} },
    false,
    (request) => launch.prepare(request),
  );
  try {
    const choices = await setup.status();
    const selected = choices.policies[Number(policyIndex)];
    assert.ok(selected && choices.teams[0]);
    await setup.select('codex', {
      teamId: choices.teams[0].team_id,
      configurationId: selected.configuration_id,
      configurationVersionId: selected.configuration_version_id,
      providerConnectionId: '',
      providerAccessMode: 'codex_subscription',
      model: 'gpt-6.1-sol',
    });
    const session = {
      id: randomUUID(),
      agent: 'codex' as const,
      cwd,
      title: 'Managed acceptance',
      updatedAt: new Date().toISOString(),
    };
    let run = await runner.start(
      session,
      'Reply with exactly KALKIDAN_ACCEPTANCE_OK. Do not use tools, read files, or perform other actions.',
      false,
      true,
    );
    const deadline = Date.now() + 90000;
    while (run.status === 'running' && Date.now() < deadline) {
      await delay(100);
      run = runner.status(run.id);
    }
    if (run.status === 'running') runner.stop(run.id);
    assert.equal(run.status, 'completed', run.error || 'Native run did not complete');
    assert.ok(
      run.messages.some(
        (message) =>
          message.role === 'assistant' && message.text.includes('KALKIDAN_ACCEPTANCE_OK'),
      ),
    );
    console.log(
      JSON.stringify({
        platform: process.platform,
        agent: 'codex',
        providerAccess: 'codex_subscription',
        managedLaunch: 'passed',
        response: 'passed',
        governance: run.governance || null,
      }),
    );
  } finally {
    runner.dispose();
    await managed.stopAll();
    client.close();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
