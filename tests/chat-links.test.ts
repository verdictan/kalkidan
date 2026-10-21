import test from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestBody, pullRequestLabel, pullRequestNumber } from '../src/lib/pull-request';
import { agentErrorMessage } from '../src/lib/agent-errors';

test('a pull request for an issue task closes the issue', () => {
  const body = pullRequestBody({
    title: 'Fix login',
    sessionTitle: 'Fix login',
    task: { title: 'Login fails', url: 'https://x/1', number: 12, repository: 'acme/web' },
  });
  assert.match(body, /^Closes acme\/web#12$/m);
  assert.match(body, /Task: \[Login fails\]\(https:\/\/x\/1\)/);
  assert.match(body, /Kalkidan chat “Fix login”/);
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
});

test('desktop codes become plain words with a Settings action', () => {
  const error = agentErrorMessage(
    new Error("Error invoking remote method 'chat-create': Error: desktop.runtime_missing"),
  );
  assert.equal(error.code, 'desktop.runtime_missing');
  assert.doesNotMatch(error.message, /desktop\./);
  assert.equal(error.action?.kind, 'settings');
  assert.equal(error.action?.section, 'managed-agents');
  // A missing region is a first setup step, like a missing runtime.
  assert.equal(
    agentErrorMessage('Select the region. [desktop.region_required]').action?.label,
    'Set up managed agents',
  );
  assert.equal(agentErrorMessage('session_busy', 'codex').action?.kind, 'retry');
  assert.equal(agentErrorMessage('spawn codex ENOENT', 'codex').action?.kind, 'install');
});
