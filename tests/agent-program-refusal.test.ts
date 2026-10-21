import test from 'node:test';
import assert from 'node:assert/strict';
import { managedLaunchBlock, managedRefusal } from '../src/domain/verdictan';
import { managedLaunchError } from '../src/lib/agent-errors';

test('a version refusal names the program path and links to its row in Settings › Agents', () => {
  const block = managedLaunchBlock({
    code: 'desktop.claude_code_version_unsupported',
    message: 'x',
    version: '2.1.287',
    path: '/home/linuxbrew/.linuxbrew/bin/claude',
  });
  assert.equal(block.path, '/home/linuxbrew/.linuxbrew/bin/claude');
  assert.equal(managedLaunchBlock({ code: 'desktop.x', path: 'relative' }).path, undefined);
  const refusal = managedRefusal('desktop.claude_code_version_unsupported', {
    computer: 'devbox',
    version: '2.1.287',
    path: '/home/linuxbrew/.linuxbrew/bin/claude',
  });
  assert.equal(
    refusal.message,
    'Devbox has Claude Code 2.1.287 at /home/linuxbrew/.linuxbrew/bin/claude. Kalkidan needs Claude Code 2.1.300 or later. Update Claude Code on devbox, or choose a different Claude Code program. Then try again.',
  );
  const error = managedLaunchError(
    {
      message: 'x',
      code: 'desktop.claude_code_version_unsupported',
      version: '2.1.287',
      path: '/home/linuxbrew/.linuxbrew/bin/claude',
    },
    { computer: 'devbox', hostId: 'h1' },
  );
  assert.deepEqual(error.action, {
    label: 'Choose the Claude Code program',
    section: 'agents',
    anchor: 'agent-program-h1-claude',
    kind: 'settings',
  });
  const unknown = managedLaunchError(
    { message: 'x', code: 'desktop.codex_version_unknown', path: '/usr/bin/codex' },
    { computer: 'this computer' },
  );
  assert.match(unknown.message, /cannot read the version of Codex at \/usr\/bin\/codex on this/);
  assert.equal(unknown.action?.anchor, 'agent-program-local-codex');
  // A refusal that is not about the version keeps its setup step.
  const other = managedLaunchError({ message: 'x', code: 'desktop.readiness_blocked' });
  assert.notEqual(other.action?.label, 'Choose the Codex program');
});
