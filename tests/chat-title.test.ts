import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatTitleFrom, shortChatTitle } from '../src/domain/chat-title';
import { history } from '../electron/history';

test('a short title is the phrase before the first preposition or comma', () => {
  assert.equal(
    shortChatTitle(
      'Add rate limits to the public API endpoints in api-service, 100 requests per minute.',
    ),
    'Add rate limits',
  );
  assert.equal(
    shortChatTitle('Add integration tests for the sign-in flow. Cover expired sessions.'),
    'Add integration tests',
  );
  assert.equal(shortChatTitle('Fix the login page'), 'Fix the login page');
  assert.equal(
    shortChatTitle('Refine project and repository navigation'),
    'Refine project and repository navigation',
  );
  // A cut needs two words first.
  assert.equal(shortChatTitle('Reply with the single word: pong'), 'Reply with the single word');
  // Six words at most. A long phrase stops before its last "and".
  assert.equal(
    shortChatTitle('Review the authentication flow and add integration tests'),
    'Review the authentication flow',
  );
  assert.equal(
    shortChatTitle('one two three four five six seven eight'),
    'One two three four five six',
  );
  assert.equal(
    shortChatTitle('please fix tests/auth/sign-in.spec.ts now'),
    'Fix tests/auth/sign-in.spec.ts now',
  );
  assert.equal(shortChatTitle('\n\n  update the README\nmore'), 'Update the README');
  assert.equal(shortChatTitle(''), '');
});

test('the agent summary wins over the first message', () => {
  assert.equal(
    chatTitleFrom({ summary: '  Sign-in  tests ', text: 'Add tests for sign-in' }),
    'Sign-in tests',
  );
  assert.equal(chatTitleFrom({ text: 'Add tests for sign-in' }), 'Add tests');
  assert.equal(chatTitleFrom({ summary: 'word '.repeat(30) }).length <= 80, true);
  assert.equal(chatTitleFrom({}), '');
});

test('history uses the Claude Code summary line as the title', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-summary-'));
  try {
    const folder = join(root, 'claude', 'projects', 'web');
    await mkdir(folder, { recursive: true });
    const user = (sessionId: string, text: string) =>
      JSON.stringify({
        type: 'user',
        sessionId,
        cwd: root,
        message: { role: 'user', content: text },
      });
    await writeFile(
      join(folder, 'named.jsonl'),
      [
        JSON.stringify({ type: 'summary', summary: 'Sign-in integration tests', leafUuid: 'x' }),
        user('named', 'Add integration tests for the sign-in flow in atlas-web.'),
      ].join('\n') + '\n',
    );
    await writeFile(
      join(folder, 'plain.jsonl'),
      user('plain', 'Add rate limits to the public API endpoints, 100 per minute.') + '\n',
    );
    const titles = Object.fromEntries(
      (await history(join(root, 'codex'), join(root, 'claude'))).sessions.map((s) => [
        s.id,
        s.title,
      ]),
    );
    assert.deepEqual(titles, { named: 'Sign-in integration tests', plain: 'Add rate limits' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
