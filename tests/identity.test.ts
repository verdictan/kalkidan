import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignIdentityColors,
  autoIdentityColor,
  demoIdentityAssignments,
  fromLegacyProjectColor,
  getIdentityOverride,
  getIdentityOverrides,
  identityColor,
  identityColorNames,
  identityHash,
  identityPalette,
  identityStyle,
  publishIdentityColors,
  isIdentityColor,
  seedIdentityOverrides,
  setIdentityOverride,
  strongestStatus,
  subscribeIdentityOverrides,
} from '../src/domain/identity';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
const events = new EventTarget();
Object.assign(globalThis, {
  localStorage: storage,
  window: {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  },
});

test('the palette has the eight agreed colors and no status hues', () => {
  assert.deepEqual(identityColorNames, [
    'blue',
    'indigo',
    'violet',
    'plum',
    'pink',
    'cyan',
    'teal',
    'slate',
  ]);
  assert.equal(identityPalette.indigo, '#4f46e5');
  assert.ok(isIdentityColor('teal'));
  assert.ok(!isIdentityColor('red'));
  assert.ok(!isIdentityColor('green'));
  assert.deepEqual(identityStyle('cyan'), { '--id': 'var(--id-cyan)' });
});

test('the hash is stable and the automatic color avoids sibling colors', () => {
  assert.equal(identityHash('atlas-web'), identityHash('atlas-web'));
  const first = autoIdentityColor('atlas-web');
  assert.equal(autoIdentityColor('Atlas-Web '), first);
  const next = autoIdentityColor('atlas-web', [first]);
  assert.notEqual(next, first);
  assert.equal(
    identityColorNames.indexOf(next),
    (identityColorNames.indexOf(first) + 1) % identityColorNames.length,
  );
  // With every color in use, the color repeats.
  assert.equal(autoIdentityColor('atlas-web', identityColorNames), first);
});

test('siblings get different colors and overrides win', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    key: `s${index}`,
    name: `Session ${index}`,
  }));
  const colors = assignIdentityColors('session', items, {});
  assert.equal(new Set(colors.values()).size, 8);
  const fixed = assignIdentityColors(
    'repo',
    [
      { key: 'a', name: 'a' },
      { key: 'b', name: 'b' },
    ],
    {
      a: 'slate',
    },
  );
  assert.equal(fixed.get('a'), 'slate');
  assert.notEqual(fixed.get('b'), 'slate');
  const explicit = assignIdentityColors('project', [{ key: 'p', name: 'p', color: 'pink' }], {});
  assert.equal(explicit.get('p'), 'pink');
});

test('a collapsed parent shows the strongest child status', () => {
  assert.equal(strongestStatus([]), null);
  assert.equal(strongestStatus(['idle', null, undefined]), null);
  assert.equal(strongestStatus(['working', 'failed']), 'failed');
  assert.equal(strongestStatus(['working', 'needs-you', 'failed']), 'needs-you');
});

test('round 10 project colors map to identity colors', () => {
  assert.equal(fromLegacyProjectColor('blue'), 'blue');
  assert.equal(fromLegacyProjectColor('violet'), 'violet');
  assert.equal(fromLegacyProjectColor('red'), null);
  assert.equal(fromLegacyProjectColor(null), null);
});

test('overrides are stored by kind and key and notify listeners', () => {
  storage.clear();
  let calls = 0;
  const stop = subscribeIdentityOverrides(() => (calls += 1));
  setIdentityOverride('project', 'Atlas', 'teal');
  assert.equal(getIdentityOverride('project', 'Atlas'), 'teal');
  assert.equal(getIdentityOverride('repo', 'Atlas'), null);
  assert.deepEqual(getIdentityOverrides('project'), { Atlas: 'teal' });
  assert.deepEqual(
    assignIdentityColors('project', [{ key: 'Atlas', name: 'Atlas' }]).get('Atlas'),
    'teal',
  );
  setIdentityOverride('project', 'Atlas', null);
  assert.equal(getIdentityOverride('project', 'Atlas'), null);
  assert.equal(calls, 2);
  stop();
  setIdentityOverride('project', 'Atlas', 'blue');
  assert.equal(calls, 2);
});

test('seeding keeps the colors that the user chose', () => {
  storage.clear();
  setIdentityOverride('project', 'Atlas', 'pink');
  seedIdentityOverrides(demoIdentityAssignments);
  assert.equal(getIdentityOverride('project', 'Atlas'), 'pink');
  assert.equal(getIdentityOverride('repo', 'atlas-web'), 'blue');
  assert.equal(getIdentityOverride('repo', 'api-service'), 'cyan');
});

test('a damaged store reads as empty', () => {
  storage.setItem('kalkidan.identity.v1', '{not json');
  assert.deepEqual(getIdentityOverrides(), {});
  storage.setItem('kalkidan.identity.v1', JSON.stringify({ 'project:x': 'red' }));
  assert.deepEqual(getIdentityOverrides(), {});
});

test('one item reads the override, then the published color, then the automatic color', () => {
  storage.clear();
  assert.equal(identityColor('session', 'abc', 'Fix race'), autoIdentityColor('Fix race'));
  assert.equal(identityColor('session', 'abc', 'Fix race', 'teal'), 'teal');
  publishIdentityColors('session', new Map([['abc', 'slate']]));
  assert.equal(identityColor('session', 'abc', 'Fix race', 'teal'), 'slate');
  setIdentityOverride('session', 'abc', 'pink');
  assert.equal(identityColor('session', 'abc', 'Fix race'), 'pink');
});
