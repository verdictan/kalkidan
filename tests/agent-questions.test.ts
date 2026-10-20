import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestions, validateAnswers } from '../electron/agents/questions';

test('question adapters validate structure, bounded answers, options, and secret text', () => {
  const raw = { id: 'q', header: 'Name', question: 'What name?', isSecret: true };
  const questions = parseQuestions('codex', [raw]);
  assert.equal(questions[0].kind, 'text');
  assert.equal(questions[0].secret, true);
  assert.deepEqual({ ...validateAnswers(questions, { q: ['Ada'] }) }, { q: ['Ada'] });
  const choice = parseQuestions('codex', [
    { ...raw, options: [{ label: 'A' }, { label: 'B', description: 'Two' }] },
  ]);
  assert.equal(choice[0].kind, 'single-choice');
  for (const input of [
    null,
    [],
    {},
    { q: [] },
    { q: [''] },
    { q: ['x'.repeat(4001)] },
    { q: ['A', 'B'] },
    { other: ['A'] },
    { q: ['A'], other: ['B'] },
  ])
    assert.throws(() => validateAnswers(choice, input));
  assert.throws(() => validateAnswers(choice, { q: ['Unavailable'] }), /available/);
  const multiple = parseQuestions('claude', [
    { ...raw, multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] },
  ]);
  assert.equal(multiple[0].kind, 'multiple-choice');
  assert.deepEqual({ ...validateAnswers(multiple, { '0': ['A', 'B'] }) }, { '0': ['A', 'B'] });
  assert.throws(() => validateAnswers(multiple, { '0': ['A', 'A'] }), /once/);
  for (const input of [
    null,
    [],
    [null],
    [{ ...raw, header: '' }],
    Array(11).fill(raw),
    [{ ...raw, options: 'invalid' }],
    [{ ...raw, options: Array(21).fill({ label: 'A' }) }],
    [{ ...raw, options: [{ label: 'A' }, { label: 'A' }] }],
    [raw, raw],
  ])
    assert.throws(() => parseQuestions('codex', input));
  assert.throws(() => parseQuestions('claude', [raw, raw]), /Duplicate/);
  const many = parseQuestions(
    'codex',
    Array.from({ length: 10 }, (_, i) => ({ ...raw, id: String(i) })),
  );
  assert.throws(
    () => validateAnswers(many, Object.fromEntries(many.map((q) => [q.id, ['x'.repeat(4000)]]))),
    /too long/,
  );
});
