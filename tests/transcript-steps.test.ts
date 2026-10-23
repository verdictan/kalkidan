import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../electron/transcript';

const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join('\n');

test('a saved Codex answer keeps the steps and the edited files of its turn', () => {
  const messages = parseTranscript(
    jsonl([
      { type: 'response_item', payload: { role: 'user', content: 'Add tests' } },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }),
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input:
            '*** Begin Patch\n*** Add File: tests/a.spec.ts\n+x\n*** Update File: package.json\n',
        },
      },
      { type: 'response_item', payload: { role: 'assistant', content: 'Done.' } },
      { type: 'response_item', payload: { role: 'user', content: 'Thanks' } },
      { type: 'response_item', payload: { role: 'assistant', content: 'You are welcome.' } },
    ]),
    'codex',
  );
  assert.equal(messages.length, 4);
  assert.deepEqual(
    messages[1].steps?.map((step) => step.title),
    ['npm test', 'Edit tests/a.spec.ts, package.json'],
  );
  assert.deepEqual(messages[1].edited, ['tests/a.spec.ts', 'package.json']);
  assert.equal(messages[3].steps, undefined);
});

test('a saved Claude Code answer counts its tool uses, not the tool results', () => {
  const messages = parseTranscript(
    jsonl([
      { type: 'user', uuid: 'u', message: { role: 'user', content: 'Fix it' } },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will look.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/r/src/a.ts' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'r',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/r/src/a.ts' } }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a3',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }] },
      },
    ]),
    'claude',
  );
  assert.deepEqual(
    messages.map((message) => message.text),
    ['Fix it', 'I will look.', 'Fixed.'],
  );
  assert.equal(messages[1].steps, undefined);
  assert.deepEqual(
    messages[2].steps?.map((step) => step.title),
    ['Read /r/src/a.ts', 'Edit /r/src/a.ts'],
  );
  assert.deepEqual(messages[2].edited, ['/r/src/a.ts']);
});
