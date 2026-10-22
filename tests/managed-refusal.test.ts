import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractiveChatRunner } from '../electron/interactive-chat';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import {
  managedLaunchBlock,
  managedOnlyNotice,
  managedRefusal,
  managedSetupTargets,
} from '../src/domain/verdictan';
import { agentErrorMessage, managedLaunchError } from '../src/lib/agent-errors';
import type { ChatRun, Session } from '../src/types';

const install = managedSetupTargets.runtime.label;

test('only a missing or old runtime gets the runtime install action', () => {
  for (const code of [
    'desktop.runtime_missing',
    'desktop.remote_runtime_missing',
    'desktop.runtime_not_found',
    'desktop.operation_unsupported',
    'desktop.claude_subscription_unsupported',
  ])
    assert.equal(managedRefusal(code).step, 'runtime', code);
  for (const code of [
    'desktop.readiness_failed',
    'desktop.readiness_required',
    'desktop.readiness_blocked',
    'desktop.evidence_unavailable',
    'desktop.event_authority_unavailable',
    'desktop.secure_storage_unavailable',
    'desktop.operation_in_progress',
    'desktop.process_isolation_unavailable',
  ]) {
    assert.notEqual(managedRefusal(code).step, 'runtime', code);
    assert.notEqual(managedLaunchBlock(new DesktopProtocolError(code)).step, 'runtime', code);
    const error = managedLaunchError({ message: 'x', code }, { computer: 'this computer' });
    assert.notEqual(error.action?.label, install, code);
  }
  assert.equal(
    managedLaunchError({ message: 'x', code: 'desktop.runtime_missing' }).action?.label,
    install,
  );
});

test('each refusal code has its own words, step and retry rule', () => {
  const where = { computer: 'build-box' };
  const blocked = managedRefusal('desktop.readiness_blocked', where);
  assert.equal(
    blocked.message,
    'The managed gateway on build-box is not ready. Try again in a moment. If it continues, check Settings › Accounts.',
  );
  assert.equal(blocked.step, 'status');
  assert.equal(blocked.retry, true);
  const authority = managedRefusal('desktop.event_authority_unavailable', where);
  assert.equal(authority.message, 'The Verdictan service did not answer in time. Try again.');
  assert.equal(authority.step, null);
  assert.equal(authority.retry, true);
  const evidence = managedRefusal('desktop.evidence_unavailable', where);
  assert.match(evidence.message, /on build-box did not send its status/);
  assert.equal(evidence.step, 'status');
  const keychain = managedRefusal('desktop.secure_storage_unavailable', where);
  assert.match(keychain.message, /system keychain on build-box\. The access was refused/);
  assert.match(keychain.message, /If the system does not ask, select Check status\./);
  // A new launch asks again. When the account runtime refused, Check status starts it again.
  assert.equal(keychain.step, 'status');
  assert.equal(keychain.retry, true);
  const busy = managedRefusal('desktop.operation_in_progress');
  assert.match(busy.message, /Another managed agents operation is running/);
  assert.equal(busy.step, null);
  assert.equal(busy.retry, true);
  const isolation = managedRefusal('desktop.process_isolation_unavailable');
  assert.equal(isolation.step, null);
  assert.equal(isolation.retry, false);
  // Distinct causes get distinct words.
  const words = new Set(
    [
      'desktop.readiness_blocked',
      'desktop.readiness_failed',
      'desktop.evidence_unavailable',
      'desktop.event_authority_unavailable',
      'desktop.secure_storage_unavailable',
      'desktop.operation_in_progress',
    ].map((code) => managedRefusal(code, where).message),
  );
  assert.equal(words.size, 6);
  for (const message of words) assert.equal(message.includes(managedOnlyNotice), false);
});

test('an old agent names the computer and the version that the launch found', () => {
  const old = managedRefusal('desktop.claude_code_version_unsupported', {
    computer: 'this computer',
    version: '2.1.296',
  });
  assert.equal(
    old.message,
    'This computer has Claude Code 2.1.296. Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code on this computer, then try again.',
  );
  assert.equal(old.step, 'agents');
  assert.match(
    managedRefusal('desktop.codex_version_unsupported', { computer: 'dev-server' }).message,
    /^Codex on dev-server is too old\. Kalkidan needs Codex 0\.160\.0 or later\./,
  );
  // A version that is not a plain version string never shows.
  assert.doesNotMatch(
    managedRefusal('desktop.codex_version_unsupported', { version: '<b>1</b>' }).message,
    /<b>/,
  );
  assert.equal(
    managedLaunchBlock(
      new DesktopProtocolError('desktop.codex_version_unsupported', { version: '0.150.0' }),
    ).version,
    '0.150.0',
  );
});

test('the managed-only notice is a note, not the first words of the refusal', () => {
  const coded = managedLaunchError(
    { message: `${managedOnlyNotice} Old text.`, code: 'desktop.readiness_blocked' },
    { computer: 'this computer' },
  );
  assert.equal(coded.note, managedOnlyNotice);
  assert.match(coded.message, /^The managed gateway on this computer is not ready\./);
  assert.equal(coded.retryFirst, true);
  // An older desktop sends no code. The text keeps its step and loses the notice prefix.
  const legacy = managedLaunchError({
    message: `${managedOnlyNotice} Sign in to Verdictan.`,
    step: 'sign-in',
  });
  assert.equal(legacy.message, 'Sign in to Verdictan.');
  assert.equal(legacy.note, managedOnlyNotice);
  // The sign-in step starts the Verdictan sign-in from the chat.
  assert.deepEqual(legacy.action, { label: 'Sign in', kind: 'sign-in' });
  const fromText = agentErrorMessage(`${managedOnlyNotice} Sign in to Verdictan.`);
  assert.equal(fromText.message, 'Sign in to Verdictan.');
  // A readiness code in an error text shows its own words and no install action.
  const text = agentErrorMessage('Check failed. [desktop.event_authority_unavailable]');
  assert.equal(text.message, 'The Verdictan service did not answer in time. Try again.');
  assert.equal(text.action?.kind, 'retry');
});

test('a blocked launch sends the safe code and the found version to the UI', async () => {
  const session: Session = { id: 'refusal', agent: 'codex', cwd: '/tmp', title: '', updatedAt: '' };
  const runner = new InteractiveChatRunner(
    async () => ({ path: '/bin/false', env: {} }),
    undefined,
    false,
    async () => {
      throw new DesktopProtocolError('desktop.codex_version_unsupported', { version: '0.150.0' });
    },
  );
  try {
    let run = (await runner.start(session, 'Hello', false)) as ChatRun;
    for (let i = 0; i < 200 && runner.status(run.id).status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    run = runner.status(run.id) as ChatRun;
    assert.equal(run.errorCode, 'managed_launch_blocked');
    assert.equal(run.managedCode, 'desktop.codex_version_unsupported');
    assert.equal(run.agentVersion, '0.150.0');
    assert.equal(run.managedSetup, 'agents');
  } finally {
    runner.dispose();
  }
});
