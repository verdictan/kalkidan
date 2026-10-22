import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStateLabel,
  checkStateTone,
  fieldTypeLabel,
  itemStateLabel,
  mutationLabel,
  optionColor,
  relativeTime,
  reviewDecisionLabel,
  roleLabel,
  sentenceCase,
  shortSha,
  statusUpdateLabel,
  viewLayoutLabel,
} from '../src/lib/github-labels';

test('GitHub enum values show as sentence-case words', () => {
  assert.equal(sentenceCase('CHANGES_REQUESTED'), 'Changes requested');
  assert.equal(sentenceCase('updateProjectV2Thing'), 'Update project v2 thing');
  assert.equal(fieldTypeLabel('SINGLE_SELECT'), 'Single select');
  assert.equal(fieldTypeLabel('NEW_KIND'), 'New kind');
  assert.equal(itemStateLabel('MERGED'), 'Merged');
  assert.equal(reviewDecisionLabel(undefined), 'No review yet');
  assert.equal(checkStateLabel('FAILURE'), 'Failed');
  assert.equal(checkStateTone('TIMED_OUT'), 'destructive');
  assert.equal(checkStateTone('QUEUED'), 'warning');
  assert.equal(statusUpdateLabel('AT_RISK'), 'At risk');
  assert.equal(viewLayoutLabel('ROADMAP_LAYOUT'), 'Roadmap');
  assert.equal(roleLabel('NONE'), 'No access');
  assert.equal(mutationLabel('addComment'), 'Post a comment');
  assert.equal(mutationLabel('someNewMutation'), 'Some new mutation');
  assert.equal(optionColor('blue').label, 'Blue');
  assert.equal(optionColor('unknown').label, 'Gray');
  assert.equal(shortSha('a1b2c3d4e5f6'), 'a1b2c3d');
});

test('relative time is the one app formatter', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(relativeTime(now - 10e3, now), 'now');
  assert.equal(relativeTime(now - 5 * 60e3, now), '5m');
  assert.equal(relativeTime(now - 3 * 3600e3, now), '3h');
  assert.equal(relativeTime('not a date', now), '');
});
