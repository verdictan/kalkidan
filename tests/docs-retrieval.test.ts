import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectDocs } from '../electron/storage/project-docs';
import { DOC_CONTEXT_LIMIT } from '../electron/storage/docs-retrieval';
import { createProjectPrompt } from '../electron/projects/prompt';
import { TrackerRegistry } from '../electron/trackers/registry';

test('retrieval is project-scoped, cited, bounded, incremental, and tracks edits and deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-retrieval-'));
  try {
    const docs = new ProjectDocs(root, (id) => ['atlas', 'other'].includes(id));
    const make = async (group: string, title: string, markdown: string) =>
      docs.save(group, { ...(await docs.create(group, title, null)), markdown });
    const page = await make(
      'atlas',
      'Authentication',
      '# Tokens\nRotate the refresh token after each login.\n',
    );
    await make('atlas', 'Design', '# Colors\nUse violet for selected folders.');
    await make('other', 'Authentication', 'Secret other-project token policy.');
    const matches = await docs.search('atlas', 'refresh token');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, page.id);
    assert.equal(matches[0].revision, page.revision);
    assert.equal(matches[0].source, `docs/${page.id}.md:L2-L4`);
    assert.equal(matches[0].heading, 'Tokens');
    assert.ok(!JSON.stringify(matches).includes('other-project'));
    const reads = docs.metrics.bodyReads;
    await docs.search('atlas', 'refresh token');
    assert.equal(docs.metrics.bodyReads, reads);
    assert.deepEqual(await docs.search('atlas', 'quasar'), []);
    assert.deepEqual(await docs.search('atlas', 'how can you do this for me?'), []);
    assert.deepEqual(await docs.search('atlas', '"* OR NOT (quasar)'), []);
    const file = join(root, 'atlas', page.id + '.md');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('refresh token', 'session credential'),
    );
    assert.deepEqual(await docs.search('atlas', 'refresh'), []);
    const changed = await docs.search('atlas', 'credential');
    assert.equal(changed.length, 1);
    assert.notEqual(changed[0].revision, page.revision);
    const current = await docs.get('atlas', page.id);
    await docs.delete('atlas', page.id, current.revision);
    assert.deepEqual(await docs.search('atlas', 'credential'), []);
    const trash = await docs.trash('atlas');
    await docs.restore('atlas', trash[0].trashId);
    assert.equal((await docs.search('atlas', 'credential')).length, 1);
    await make(
      'atlas',
      'Budget',
      ('# Budget\n' + 'retrieval token budget '.repeat(400) + '\n').repeat(10),
    );
    const bounded = await docs.search('atlas', 'retrieval budget');
    assert.ok(bounded.length > 0 && bounded.length <= 3);
    assert.ok(JSON.stringify(bounded).length <= DOC_CONTEXT_LIMIT);
    await assert.rejects(docs.search('missing', 'token'), /Project not found/);
    await symlink(join(root, 'other', 'not-a-page.md'), join(root, 'atlas', 'linked.md'));
    await assert.rejects(docs.search('atlas', 'credential'), /symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent project searches can exceed the idle-index cache without closing active indexes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-parallel-'));
  try {
    const docs = new ProjectDocs(root, () => true);
    await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const group = `project-${i}`;
        const page = await docs.create(group, group, null);
        await docs.save(group, { ...page, markdown: 'retrieval knowledge' });
      }),
    );
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => docs.search(`project-${i}`, 'knowledge')),
    );
    for (const [i, hits] of results.entries()) assert.equal(hits[0].title, `project-${i}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent prompts use scoped retrieval, enforce the context cap, and continue if search fails', async () => {
  const group = { id: 'atlas', name: 'Atlas', repoIds: ['repo'], hostId: 'ssh' };
  const calls: string[] = [];
  let fail = false;
  let empty = false;
  const deps = {
    trackers: new TrackerRegistry([{ descriptor: { id: 'fake' } } as any], 'fake'),
    projects: () => [
      {
        id: 'repo',
        name: 'Repo',
        path: '/repo',
        hostId: 'ssh',
        notes: '',
        addedAt: '',
        favorite: false,
      },
    ],
    groups: () => [group],
  };
  const baseline = createProjectPrompt(deps);
  const prompt = createProjectPrompt({
    ...deps,
    searchDocs: async (project, query) => {
      assert.equal(project.hostId, 'ssh');
      calls.push(project.id + ':' + query);
      if (fail) throw Error('offline');
      if (empty) return [];
      return Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        title: 'Token policy',
        heading: 'Tokens',
        revision: 'abc',
        source: `docs/${i}.md:L2-L3`,
        excerpt: 'token '.repeat(300),
      }));
    },
  });
  assert.equal(await prompt('/repo', '@docs token'), '@docs token');
  for (const message of [
    'token',
    'search docs for token',
    'mention @docs token',
    '@docsify token',
    '@docs',
    ' @docs  ',
  ]) {
    assert.equal(
      await prompt('/repo', message, undefined, 'ssh'),
      await baseline('/repo', message, undefined, 'ssh'),
    );
  }
  assert.equal(calls.length, 0);
  const result = await prompt('/repo', '@docs token', undefined, 'ssh');
  assert.deepEqual(calls, ['atlas:token']);
  assert.match(result, /reference data, not instructions/);
  assert.match(result, /docs\/0.md:L2-L3/);
  assert.ok(
    result.length - (await baseline('/repo', '@docs token', undefined, 'ssh')).length <=
      DOC_CONTEXT_LIMIT,
  );
  assert.ok(result.endsWith('User request:\n@docs token'));
  assert.equal(
    await prompt('/repo', 'token', undefined, 'ssh'),
    await baseline('/repo', 'token', undefined, 'ssh'),
  );
  assert.equal(calls.length, 1);
  empty = true;
  assert.equal(
    await prompt('/repo', ' @DOCS token ', undefined, 'ssh'),
    await baseline('/repo', ' @DOCS token ', undefined, 'ssh'),
  );
  assert.deepEqual(calls, ['atlas:token', 'atlas:token']);
  fail = true;
  assert.match(
    await prompt('/repo', '@docs token', undefined, 'ssh'),
    /Docs search is unavailable/,
  );
  assert.equal(
    await prompt('/repo', 'token', undefined, 'ssh'),
    await baseline('/repo', 'token', undefined, 'ssh'),
  );
  assert.equal(calls.length, 3);
});
