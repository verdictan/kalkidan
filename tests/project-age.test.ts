import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectAge } from '../src/lib/project-age';

test('projectAge gives the age of the last chat as in the Projects table', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(projectAge(ago(20_000), now), 'now');
  assert.equal(projectAge(ago(5 * 60_000), now), '5 min');
  assert.equal(projectAge(ago(3 * 3_600_000 + 60_000), now), '3 h');
  assert.equal(projectAge(ago(2 * 86_400_000), now), '2 d');
  assert.equal(projectAge('not a date', now), '');
});
