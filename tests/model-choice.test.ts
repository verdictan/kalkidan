import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenModel, modelChoice } from '../src/domain/model-choice';

const models = [
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'opus', name: 'Opus' },
  { id: 'haiku', name: 'Haiku' },
];

test('a managed setup offers only the allowed models and marks the setup model', () => {
  const choice = modelChoice({
    models,
    allowed: ['opus', 'sonnet'],
    setupModel: 'sonnet',
    agentName: 'Claude Code',
  });
  assert.deepEqual(choice, {
    managed: true,
    defaultName: 'Sonnet',
    options: [
      { id: 'opus', name: 'Opus', isDefault: false },
      { id: 'sonnet', name: 'Sonnet', isDefault: true },
    ],
    fixed: false,
  });
  assert.equal(chosenModel(choice, 'opus'), 'opus');
  // A model that the organization does not allow is never sent.
  assert.equal(chosenModel(choice, 'haiku'), '');
  assert.equal(chosenModel(choice, ''), '');
});

test('one allowed model makes the chip a label', () => {
  const choice = modelChoice({
    models,
    allowed: ['gpt-6-astra'],
    setupModel: 'gpt-6-astra',
    agentName: 'Codex',
  });
  assert.equal(choice.fixed, true);
  assert.deepEqual(choice.options, [{ id: 'gpt-6-astra', name: 'gpt-6-astra', isDefault: true }]);
});

test('the setup model shows when the list leaves it out', () => {
  const choice = modelChoice({ models, allowed: ['opus'], setupModel: 'sonnet', agentName: 'x' });
  assert.deepEqual(
    choice.options.map((option) => option.id),
    ['sonnet', 'opus'],
  );
  // Without a list from the service, the agent's models apply.
  const open = modelChoice({ models, setupModel: 'opus', agentName: 'x' });
  assert.deepEqual(
    open.options.map((option) => [option.id, option.isDefault]),
    [
      ['sonnet', false],
      ['opus', true],
      ['haiku', false],
    ],
  );
});

test('without managed setup, the agent default and its models apply', () => {
  const choice = modelChoice({ models, allowed: ['opus'], agentName: 'Claude Code' });
  assert.equal(choice.managed, false);
  assert.equal(choice.defaultName, 'Claude Code · Default');
  assert.equal(choice.options.length, 3);
  assert.equal(choice.fixed, false);
});
