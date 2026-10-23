import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pullRequestBody,
  pullRequestLabel,
  pullRequestNumber,
  pullRequestTitle,
} from '../src/lib/pull-request';
import { agentErrorMessage } from '../src/lib/agent-errors';

test('a pull request for an issue task closes the issue', () => {
  const body = pullRequestBody({
    title: 'Fix login',
    sessionTitle: 'Fix login',
    task: { title: 'Login fails', url: 'https://x/1', number: 12, repository: 'acme/web' },
  });
  assert.match(body, /^Closes acme\/web#12$/m);
  assert.match(body, /Task: \[Login fails\]\(https:\/\/x\/1\)/);
  // No boilerplate line (CH-20).
  assert.doesNotMatch(body, /Kalkidan chat/);
});

test('the pull request body drops a leading "Done."', () => {
  const body = pullRequestBody({ title: 'A', sessionTitle: 'A', summary: 'Done. Tests pass.' });
  assert.equal(body, 'Tests pass.');
});

test('the pull request title is short', () => {
  assert.equal(pullRequestTitle('Add sign-in integration tests'), 'Add sign-in integration tests');
  assert.equal(
    pullRequestTitle(
      'Add integration tests for the sign-in flow in atlas-web. Cover expired sessions.',
    ),
    'Add integration tests for the sign-in flow in atlas-web',
  );
  assert.equal(pullRequestTitle('New Codex chat'), '');
  assert.ok(pullRequestTitle('word '.repeat(40)).length <= 72);
});

test('a pull request for a draft task has no closing keyword', () => {
  const body = pullRequestBody({ title: 'A', sessionTitle: 'Chat', task: { title: 'Draft' } });
  assert.doesNotMatch(body, /Closes/);
  assert.match(body, /^A\n/);
});

test('pull request number and label', () => {
  assert.equal(pullRequestNumber('https://github.com/a/b/pull/42'), 42);
  assert.equal(pullRequestNumber('https://github.com/a/b'), undefined);
  assert.equal(pullRequestLabel({ url: 'u', number: 12, state: 'open' }), 'PR #12 · Open');
  assert.equal(
    pullRequestLabel({ url: 'u', number: 12, state: 'open', draft: true }),
    'PR #12 · Draft',
  );
  // A merged pull request is not a draft, even when an old value says so.
  assert.equal(
    pullRequestLabel({ url: 'u', number: 12, state: 'merged', draft: true }),
    'PR #12 · Merged',
  );
});

test('desktop codes become plain words with one fix of the round 11 model', () => {
  // A gateway runtime failure: Try again repairs the runtime, then sends again.
  const error = agentErrorMessage(
    new Error("Error invoking remote method 'chat-create': Error: desktop.runtime_missing"),
  );
  assert.equal(error.code, 'desktop.runtime_missing');
  assert.doesNotMatch(error.message, /desktop\.|managed agent/i);
  assert.equal(error.action?.kind, 'gateway-retry');
  assert.equal(error.action?.label, 'Try again');
  // A missing region needs the sign-in.
  assert.equal(
    agentErrorMessage('Select the region. [desktop.region_required]').action?.kind,
    'sign-in',
  );
  assert.equal(agentErrorMessage('session_busy', 'codex').action?.kind, 'retry');
  // A missing agent CLI links to its install guide and Settings › Tools.
  const missing = agentErrorMessage('spawn codex ENOENT', 'codex');
  assert.match(missing.message, /^Codex is not installed\./);
  assert.deepEqual(missing.action, {
    label: 'Install guide',
    section: 'tools',
    kind: 'install',
    url: 'https://github.com/openai/codex',
  });
  assert.equal(
    agentErrorMessage('Not found. [desktop.agent_not_found]', 'claude').message,
    'Claude Code is not installed. Install it, then restart Kalkidan to find it.',
  );
  // The browser preview runs no agent and offers no setup.
  const preview = agentErrorMessage('The browser preview cannot run agents. Open the app.');
  assert.equal(preview.action, undefined);
});
