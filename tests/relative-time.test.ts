import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullTime, relativeTime } from '../src/lib/relative-time';
import { relativeTime as githubRelativeTime } from '../src/lib/github-labels';

const now = Date.parse('2026-10-21T12:00:00Z');
const weekday = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { weekday: 'short' });

test('relative time: now, minutes, hours, weekday, then a date', () => {
  assert.equal(relativeTime(now, now), 'now');
  assert.equal(relativeTime(now - 59e3, now), 'now');
  assert.equal(relativeTime(now - 60e3, now), '1m');
  assert.equal(relativeTime(now - 2 * 60e3, now), '2m');
  assert.equal(relativeTime(now - 59 * 60e3, now), '59m');
  assert.equal(relativeTime(now - 3 * 3600e3, now), '3h');
  assert.equal(relativeTime(now - 23 * 3600e3, now), '23h');
  assert.equal(relativeTime(now - 2 * 86400e3, now), weekday(now - 2 * 86400e3));
  assert.equal(relativeTime(now - 5 * 86400e3, now), weekday(now - 5 * 86400e3));
  const old = now - 30 * 86400e3;
  assert.equal(
    relativeTime(old, now),
    new Date(old).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  );
  const lastYear = Date.parse('2025-03-04T12:00:00Z');
  assert.match(relativeTime(lastYear, now), /2025/);
});

test('relative time accepts strings and dates, and rejects bad values', () => {
  assert.equal(relativeTime(new Date(now - 5 * 60e3).toISOString(), now), '5m');
  assert.equal(relativeTime(new Date(now - 5 * 60e3), now), '5m');
  assert.equal(relativeTime(now + 3600e3, now), 'now');
  assert.equal(relativeTime(undefined, now), '');
  assert.equal(relativeTime(null, now), '');
  assert.equal(relativeTime('', now), '');
  assert.equal(relativeTime('not a date', now), '');
  assert.equal(fullTime('not a date'), '');
  assert.equal(fullTime(''), '');
  assert.notEqual(fullTime(new Date(now).toISOString()), '');
});

test('GitHub labels use the same formatter', () => {
  assert.equal(githubRelativeTime, relativeTime);
});
