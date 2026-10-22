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

test('agent prompts use managed memory tools and tolerate unavailable storage', async () => {
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
  assert.match(result, /kalkidan-memory MCP tools/);
  assert.doesNotMatch(result, /\/projects\/one\/memory/);
  assert.match(result, /or load the whole library/);
  assert.doesNotMatch(result, /Docs search is unavailable/);
  fail = true;
  assert.match(await prompt('/repo', 'Implement a feature'), /Project memory is unavailable/);
});

test('memory topics read as words and the page does not repeat its title', async () => {
  const { memoryTopicName, withoutRepeatedTitle, entryForPage, extractionText } =
    await import('../src/components/project-memory');
  assert.equal(memoryTopicName({ name: 'test-conventions.md' }), 'Test conventions');
  assert.equal(memoryTopicName({ topic: 'release steps', name: 'x.md' }), 'Release steps');
  assert.equal(
    withoutRepeatedTitle('# Release steps\n\nTag first.', 'Release steps'),
    'Tag first.',
  );
  assert.equal(withoutRepeatedTitle('# Other\n\nText', 'Release steps'), '# Other\n\nText');
  const entry = {
    version: 1 as const,
    id: 'e',
    topic: 'release steps',
    content: 'Tag first.',
    revision: 'r',
    provenance: 'verified' as const,
    source: { sessionId: 's', turnId: 't', references: [] },
    createdAt: '',
    updatedAt: '',
    supersedes: [],
  };
  const page = {
    topic: 'release steps',
    name: 'a.md',
    content: 'Tag first.',
    updatedAt: '',
    truncated: false,
  };
  assert.equal(entryForPage(page, [entry]), entry);
  assert.equal(entryForPage({ ...page, topic: 'other' }, [entry]), undefined);
  const base = { id: 'x', turnId: 't', updatedAt: '' };
  assert.equal(extractionText({ ...base, status: 'saved', saved: 2 }), 'Saved 2 facts');
  assert.equal(extractionText({ ...base, status: 'saved', saved: 0 }), 'Nothing new to save');
  assert.equal(extractionText({ ...base, status: 'failed' }), 'Could not save memory');
});

test('memory search matches the topic and the text', async () => {
  const { memoryMatches } = await import('../src/components/project-memory');
  const page = { name: 'testing.md', content: 'Run npm test before a pull request.' };
  assert.ok(memoryMatches(page, 'testing'));
  assert.ok(memoryMatches(page, 'npm PULL'));
  assert.ok(memoryMatches(page, ''));
  assert.ok(!memoryMatches(page, 'deploy'));
});

test('a memory save result maps to one outcome', async () => {
  const { memorySaveOutcome } = await import('../src/components/project-memory');
  const entry = {
    version: 1 as const,
    id: 'e',
    topic: 'testing',
    content: 'Run npm test.',
    revision: 'r',
    provenance: 'user' as const,
    source: { sessionId: '', turnId: '', references: [] },
    createdAt: '',
    updatedAt: '',
    supersedes: [],
  };
  assert.deepEqual(memorySaveOutcome({ status: 'saved', entry }), {
    kind: 'saved',
    topic: 'Testing',
  });
  assert.deepEqual(memorySaveOutcome({ status: 'duplicate', entry }), { kind: 'duplicate' });
  assert.deepEqual(memorySaveOutcome({ status: 'conflict', id: 'e', revision: 's' }), {
    kind: 'conflict',
  });
  assert.deepEqual(memorySaveOutcome({ status: 'deferred', reason: 'Busy.' }), {
    kind: 'deferred',
    reason: 'Busy.',
  });
});
