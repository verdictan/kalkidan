import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryDirectory, readProjectMemory } from '../electron/storage/project-memory';
import { createProjectPrompt } from '../electron/projects/prompt';
import { TrackerRegistry } from '../electron/trackers/registry';

test('memory reads agent Markdown updates, isolates projects, and bounds previews', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-memory-'));
  try {
    const directory = await memoryDirectory(join(root, 'one'));
    assert.deepEqual(await readProjectMemory(join(root, 'one')), { pages: [], limited: false });
    await writeFile(join(directory, 'conventions.md'), '# Conventions\nUse npm.');
    await writeFile(join(directory, 'ignored.json'), '{}');
    const other = await memoryDirectory(join(root, 'two'));
    await writeFile(join(other, 'private.md'), 'Other project');
    await symlink(join(other, 'private.md'), join(directory, 'linked.md'));
    let result = await readProjectMemory(join(root, 'one'));
    assert.equal(result.pages.length, 1);
    assert.match(result.pages[0].content, /Use npm/);
    await writeFile(join(directory, 'conventions.md'), 'Updated convention');
    result = await readProjectMemory(join(root, 'one'));
    assert.equal(result.pages[0].content, 'Updated convention');
    await writeFile(join(directory, 'large.md'), 'x'.repeat(100000));
    const large = (await readProjectMemory(join(root, 'one'))).pages.find(
      (p) => p.name === 'large.md',
    )!;
    assert.equal(large.content.length, 65536);
    assert.equal(large.truncated, true);
    await mkdir(join(root, 'three'));
    await symlink(other, join(root, 'three', 'memory'));
    await assert.rejects(readProjectMemory(join(root, 'three')), /symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent prompts share only the scoped memory path and tolerate unavailable storage', async () => {
  const group = { id: 'one', name: 'One', repoIds: ['repo'] };
  let fail = false;
  let calls = 0;
  const prompt = createProjectPrompt({
    projects: () => [
      { id: 'repo', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
    ],
    groups: () => [group],
    trackers: new TrackerRegistry([{ descriptor: { id: 'fake' } } as any], 'fake'),
    memoryPath: async (g) => {
      calls++;
      assert.equal(g.id, 'one');
      if (fail) throw Error('offline');
      return '/projects/one/memory';
    },
    searchDocs: async () => {
      throw Error('Ordinary messages must not search docs');
    },
  });
  assert.equal(await prompt('/elsewhere', 'Implement a feature'), 'Implement a feature');
  assert.equal(calls, 0);
  const result = await prompt('/repo', 'Implement a feature');
  assert.match(result, /\/projects\/one\/memory/);
  assert.match(result, /Do not load the whole folder/);
  assert.doesNotMatch(result, /Docs search is unavailable/);
  fail = true;
  assert.match(await prompt('/repo', 'Implement a feature'), /Project memory is unavailable/);
});
