import test from 'node:test';
import assert from 'node:assert/strict';
import { agentErrorMessage, managedLaunchError } from '../src/lib/agent-errors';

const text = 'The managed agents service did not accept the sign-in. [desktop.session_rejected]';

test('a rejected session of a signed-in account is a refused agent connection', () => {
  for (const error of [
    agentErrorMessage(text, 'codex', { regionSaved: true, signedIn: true }),
    managedLaunchError(
      { message: text, code: 'desktop.session_rejected' },
      { regionSaved: true, signedIn: true, hostId: 'host', agent: 'codex' },
    ),
  ]) {
    assert.equal(
      error.message,
      "This chat's agent connection was refused. Try again, or fork the chat to continue it with the agent of this computer.",
    );
    assert.doesNotMatch(error.message, /sign-in expired/);
    assert.equal(error.action?.kind, 'fork');
    assert.equal(error.action?.label, 'Fork chat');
    // Try again shows first.
    assert.equal(error.retryFirst, true);
  }
});

test('a rejected session of a signed-out account still asks for a sign-in', () => {
  for (const signedIn of [false, undefined]) {
    const error = agentErrorMessage(text, 'codex', { regionSaved: true, signedIn });
    assert.match(error.message, /sign-in expired/);
    assert.equal(error.action?.kind, 'sign-in');
  }
});
