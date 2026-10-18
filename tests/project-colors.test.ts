import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectGroups } from '../electron/project-groups';
test('project colors persist, reset, and reject invalid values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-colors-'));
  try {
    const file = join(root, 'groups.json');
    await writeFile(file, JSON.stringify([{ id: 'g', name: 'Atlas', repoIds: ['repo'] }]));
    const groups = new ProjectGroups(file);
    await groups.load();
    await groups.setColor('g', 'violet');
    const restored = new ProjectGroups(file);
    await restored.load();
    assert.equal(restored.groups[0].color, 'violet');
    assert.deepEqual(restored.groups[0].repoIds, ['repo']);
    assert.throws(() => groups.setColor('g', 'invalid' as any), /Invalid project color/);
    await assert.rejects(groups.setColor('missing', 'red'), /not found/);
    await restored.setColor('g', null);
    await groups.load();
    assert.equal(groups.groups[0].color, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
