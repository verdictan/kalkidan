import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InteractiveChatRunner } from '../electron/interactive-chat';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import { SubscriptionRecoveryError } from '../electron/verdictan/launch';
import {
  managedLaunchBlock,
  managedOnlyNotice,
  managedSetupTargets,
} from '../src/domain/verdictan';
import type { ChatRun, Session } from '../src/types';

const root = join(import.meta.dirname, '..');
const session: Session = {
  id: 'managed-only',
  agent: 'claude',
  cwd: root,
  title: 'Managed only',
  updatedAt: '',
};
async function settle(runner: InteractiveChatRunner, run: ChatRun) {
  for (let i = 0; i < 200 && runner.status(run.id).status === 'running'; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  return runner.status(run.id) as ChatRun;
}

test('a runner without the managed launch step never starts an agent process', async () => {
  let resolved = 0;
  const runner = new InteractiveChatRunner(async () => {
    resolved++;
    return { path: '/bin/false', env: {} };
  });
  try {
    const run = await settle(runner, await runner.start(session, 'Hello', false));
    assert.equal(run.status, 'failed');
    assert.equal(run.errorCode, 'managed_launch_blocked');
    assert.equal(run.managedSetup, 'runtime');
    assert.ok(run.error!.startsWith(managedOnlyNotice));
    // The executable is not even looked up: there is no direct CLI path.
    assert.equal(resolved, 0);
  } finally {
    runner.dispose();
  }
});

test('managed launch failures explain the managed-only rule and name the setup step', async () => {
  const cases: [Error, string][] = [
    [new DesktopProtocolError('desktop.setup_selection_required'), 'agent-setup'],
    [new DesktopProtocolError('desktop.auth_required'), 'sign-in'],
    [new DesktopProtocolError('desktop.region_required'), 'region'],
    [new DesktopProtocolError('desktop.runtime_missing'), 'runtime'],
    [new DesktopProtocolError('desktop.host_runtime_missing'), 'runtime'],
    [new DesktopProtocolError('desktop.resume_binding_required'), 'agent-setup'],
    [new DesktopProtocolError('desktop.gateway_unavailable'), 'status'],
    [new SubscriptionRecoveryError('desktop.claude_subscription_login_required'), 'agent-setup'],
    [new Error('Unexpected launch failure.'), 'status'],
  ];
  for (const [error, step] of cases) {
    const runner = new InteractiveChatRunner(
      async () => ({ path: '/bin/false', env: {} }),
      undefined,
      false,
      async () => {
        throw error;
      },
    );
    try {
      const run = await settle(runner, await runner.start(session, 'Hello', false));
      assert.equal(run.errorCode, 'managed_launch_blocked', error.message);
      assert.equal(run.managedSetup, step, error.message);
      assert.ok(run.error!.startsWith(managedOnlyNotice), String(run.error));
      // Raw protocol codes never reach the user.
      assert.doesNotMatch(run.error!, /desktop\.[a-z_]+/);
    } finally {
      runner.dispose();
    }
  }
});

test('every launch block message is consistent and has a Settings target', () => {
  const source = [
    'desktop.unknown_code',
    'desktop.agent_version_unsupported',
    'desktop.process_isolation_unavailable',
    'desktop.claude_subscription_unsupported',
    'desktop.subscription_target_required',
    'not a code',
    undefined,
    { code: 7 },
  ];
  for (const value of source) {
    const block = managedLaunchBlock(value);
    assert.ok(block.message.startsWith(managedOnlyNotice));
    assert.equal(block.message.split(managedOnlyNotice).length, 2, 'notice appears once');
    assert.doesNotMatch(block.message, /desktop\.[a-z_]+/);
    assert.ok(managedSetupTargets[block.step].anchor);
    // No message suggests running a local agent CLI.
    assert.doesNotMatch(block.message, /run (?:codex|claude)\b|local cli|in your terminal/i);
  }
  assert.equal(managedLaunchBlock('desktop.subscription_target_required').step, 'agent-setup');
  assert.equal(managedLaunchBlock('desktop.claude_subscription_unsupported').step, 'runtime');
  const repeated = managedLaunchBlock(
    new Error(managedLaunchBlock('desktop.auth_required').message),
  );
  assert.equal(repeated.message.split(managedOnlyNotice).length, 2);
});

test('no source path starts a local agent CLI outside the managed launch', async () => {
  const runner = await readFile(join(root, 'electron', 'interactive-chat.ts'), 'utf8');
  // The only agent spawn uses the prepared managed launch.
  assert.match(runner, /spawn\(\s*run\.managed\.executable,/);
  assert.doesNotMatch(runner, /resolved\.path,/);
  const files = (await readdir(join(root, 'electron'), { recursive: true })).filter(
    (name) => typeof name === 'string' && name.endsWith('.ts'),
  );
  for (const name of files) {
    const text = await readFile(join(root, 'electron', name), 'utf8');
    // The runner itself and the one composition point that requires a managed launch.
    if (['interactive-chat.ts', join('agents', 'runtime.ts')].includes(name)) continue;
    assert.ok(
      !/new InteractiveChatRunner\(/.test(text),
      `${name} must use createAgentRuntimes with a managed launch`,
    );
  }
  const desktop = await readFile(join(root, 'src', 'demo.ts'), 'utf8');
  assert.match(desktop, /previewAgentBlock/);
});
