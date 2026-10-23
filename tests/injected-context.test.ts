import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, visibleUserText } from '../electron/transcript';

const environment =
  '<environment_context>\n  <cwd>/Users/someone/project</cwd>\n  <shell>zsh</shell>\n  <current_date>2026-10-23</current_date>\n  <timezone>Europe/Berlin</timezone>\n  <filesystem><permission_profile type="disabled"></permission_profile></filesystem>\n</environment_context>';
const user = (text: string) =>
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  });

test('a Codex transcript shows no injected environment or instructions as user messages', () => {
  const rollout = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'thread', cwd: '/Users/someone' } }),
    user(environment),
    user(
      '# AGENTS.md instructions for /Users/someone/project\n\n<INSTRUCTIONS>Be brief.</INSTRUCTIONS>',
    ),
    user('<user_instructions>Use tabs.</user_instructions>'),
    user('Reply with the single word: pong'),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'pong' }],
      },
    }),
  ].join('\n');
  const messages = parseTranscript(rollout, 'codex');
  assert.deepEqual(
    messages.map((m) => [m.role, m.text]),
    [
      ['user', 'Reply with the single word: pong'],
      ['assistant', 'pong'],
    ],
  );
  // No local path or environment detail leaks into the transcript.
  assert.doesNotMatch(JSON.stringify(messages), /\/Users\/someone|zsh|Europe|AGENTS/);
});

test('the user text stays when an agent adds a block to the same message', () => {
  assert.equal(visibleUserText(`${environment}\nFix the login page`), 'Fix the login page');
  assert.equal(visibleUserText('Fix it<system-reminder>Private note</system-reminder>'), 'Fix it');
  // Text that the user wrote with angle brackets stays.
  assert.equal(visibleUserText('<div> is a block element'), '<div> is a block element');
});
