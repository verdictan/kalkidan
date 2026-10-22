import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectGroups } from '../electron/project-groups';
import { isProjectColor, projectColors, type ProjectColor } from '../src/domain/project-colors';
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

function luminance(hex: string) {
  const channels = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test('project colors have 3:1 contrast on the white background', () => {
  for (const name of Object.keys(projectColors) as ProjectColor[]) {
    const value = projectColors[name];
    assert.match(value, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(value, '#ffffff') >= 3, `${name} ${value}`);
    assert.ok(isProjectColor(name));
  }
  assert.ok(!isProjectColor('toString'));
});
