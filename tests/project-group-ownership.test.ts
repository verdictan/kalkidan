import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectGroups } from '../electron/project-groups';
test('independent project owners reload under the filesystem lease and retain both changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-owners-'));
  try {
    const a = new ProjectGroups(join(root, 'groups.json'));
    const b = new ProjectGroups(join(root, 'groups.json'));
    await Promise.all([a.load(), b.load()]);
    const [first, second] = await Promise.all([a.create('First', null), b.create('Second', null)]);
    await Promise.all([a.update(first, 'Renamed'), b.setColor(second, 'blue')]);
    await a.load();
    assert.equal(a.groups.length, 2);
    assert.equal(a.groups.find((group) => group.id === first)?.name, 'Renamed');
    assert.equal(a.groups.find((group) => group.id === second)?.color, 'blue');
    await b.create('Renamed', null, undefined, undefined, first);
    assert.equal(b.groups.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
