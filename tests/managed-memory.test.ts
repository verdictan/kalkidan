import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedMemory, type MemoryScope } from '../electron/storage/managed-memory';
import { extractMemory } from '../electron/storage/memory-extraction';
import { readProjectMemory } from '../electron/storage/project-memory';
import { resourceRevision } from '../electron/storage/resource-revision';
import * as filesystem from 'node:fs/promises';
import { backendLoader } from './helpers/backend-loader';

const candidate = (content = 'Use npm test.') => ({
  topic: 'Tests',
  content,
  references: [{ id: 'user', quote: content }],
});
async function setup(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'managed-memory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scope: MemoryScope = {
    root,
    sessionId: 'session',
    turnId: 'turn',
    sources: () => [
      { id: 'user', text: 'Use npm test.\nUse npm run build.\nUse the main branch.' },
    ],
  };
  return {
    root,
    scope,
    memory: new ManagedMemory(
      scope,
      () => {},
      () => '2026-10-20T00:00:00Z',
    ),
  };
}
test('managed memory saves sourced facts atomically, serializes revisions, and bounds search', async (t) => {
  const { root, memory } = await setup(t);
  const result = await memory.upsert(candidate());
  assert.equal(result.status, 'saved');
  if (result.status !== 'saved') throw Error('Expected save');
  assert.equal(result.entry.source.sessionId, 'session');
  assert.equal(result.entry.source.turnId, 'turn');
  assert.equal((await memory.upsert(candidate())).status, 'duplicate');
  const attempts = await Promise.all([
    memory.upsert({
      ...candidate('Use npm run build.'),
      id: result.entry.id,
      expectedRevision: result.entry.revision,
    }),
    memory.upsert({
      ...candidate('Use the main branch.'),
      id: result.entry.id,
      expectedRevision: result.entry.revision,
    }),
  ]);
  assert.deepEqual(attempts.map((value) => value.status).sort(), ['conflict', 'saved']);
  const winner = attempts.findIndex((value) => value.status === 'saved');
  const content = ['Use npm run build.', 'Use the main branch.'][winner];
  assert.equal((await memory.read(result.entry.id)).content, content);
  assert.equal((await memory.search('Use'))[0].excerpt, content);
  assert.deepEqual(await memory.search(''), []);
  await assert.rejects(memory.search('x'.repeat(1001)), /query/);
  await assert.rejects(memory.read('missing'), /not found/);
  const preview = await readProjectMemory(root);
  assert.equal(preview.pages[0].content, content);
  assert.equal(preview.pages[0].topic, 'Tests');
  assert.equal(
    (await readdir(join(root, 'memory'))).some((name) => name.endsWith('.tmp')),
    false,
  );
});
test('memory rejects secrets, unsupported claims, invalid references and paths', async (t) => {
  const { scope, memory } = await setup(t);
  assert.equal((await memory.upsert({ ...candidate(), content: 'Use yarn.' })).status, 'deferred');
  assert.equal((await memory.upsert({ ...candidate(), references: [] })).status, 'deferred');
  assert.equal((await memory.upsert(candidate('password=secret'))).status, 'deferred');
  scope.sources = () => [{ id: 'user', text: 'Use npm test. password=secret' }];
  assert.equal(
    (
      await memory.upsert({
        ...candidate(),
        references: [{ id: 'user', quote: 'Use npm test. password=secret' }],
      })
    ).status,
    'deferred',
  );
  await assert.rejects(memory.upsert({ ...candidate(), id: '../outside' }), /Invalid/);
  await assert.rejects(memory.upsert({ ...candidate(), content: '' }), /Invalid/);
  await assert.rejects(memory.upsert({ ...candidate(), topic: 'x'.repeat(121) }), /Invalid/);
  assert.equal((await memory.list()).length, 0);
});
test('legacy files retain their exact text, external edits stay separate and symlinks are rejected', async (t) => {
  const { root, memory } = await setup(t);
  await memory.list();
  const legacy = join(root, 'memory', 'legacy.md');
  await writeFile(legacy, '# Original text\n\nUse npm test.\n');
  const entry = (await memory.list())[0];
  assert.equal(entry.provenance, 'legacy');
  assert.equal((await memory.list())[0].id, entry.id);
  assert.equal(await readFile(legacy, 'utf8'), '# Original text\n\nUse npm test.\n');
  assert.equal(
    (await memory.upsert({ ...candidate(), id: entry.id, expectedRevision: entry.revision }))
      .status,
    'deferred',
  );
  const saved = await memory.upsert(candidate());
  if (saved.status !== 'saved') throw Error('Expected save');
  const file = join(root, 'memory', saved.entry.id + '.md');
  await writeFile(
    file,
    (await readFile(file, 'utf8')).replace(' -->\nUse npm test.', ' -->\nExternal edit'),
  );
  assert.equal((await memory.read(saved.entry.id)).provenance, 'external');
  await symlink(legacy, join(root, 'memory', 'link.md'));
  await assert.rejects(memory.list(), /ELOOP|symbolic/);
});
test('supersession requires a current revision and preserves source history', async (t) => {
  const { memory } = await setup(t);
  const first = await memory.upsert(candidate());
  if (first.status !== 'saved') throw Error('Expected save');
  assert.equal(
    (
      await memory.upsert({
        ...candidate('Use npm run build.'),
        supersedes: [{ id: first.entry.id, revision: 'stale' }],
      })
    ).status,
    'conflict',
  );
  const next = await memory.upsert({
    ...candidate('Use npm run build.'),
    supersedes: [{ id: first.entry.id, revision: first.entry.revision }],
  });
  assert.equal(next.status, 'saved');
  assert.equal((await memory.search('npm')).length, 1);
  assert.equal((await memory.read(first.entry.id)).content, 'Use npm test.');
});
test('extraction coalesces completion events, persists outcomes and never fails the user turn', async (t) => {
  const { root, scope } = await setup(t);
  const abort = new AbortController();
  let calls = 0;
  const extract = async (input: string) => {
    calls++;
    assert.ok(input.length < 13000);
    return JSON.stringify([candidate()]);
  };
  const results = await Promise.all([
    extractMemory(scope, extract, abort.signal),
    extractMemory(scope, extract, abort.signal),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].status, 'saved');
  await extractMemory(scope, extract, abort.signal);
  assert.equal(calls, 1);
  assert.equal((await readProjectMemory(root)).extraction?.status, 'saved');
  const before = await resourceRevision(root, 'memory');
  const fail = await extractMemory(
    { ...scope, turnId: 'failed' },
    async () => {
      throw Error('private detail');
    },
    abort.signal,
  );
  assert.equal(fail.status, 'failed');
  assert.doesNotMatch(fail.error || '', /private detail/);
  assert.notEqual(await resourceRevision(root, 'memory'), before);
  abort.abort();
  assert.equal(
    (await extractMemory({ ...scope, turnId: 'canceled' }, extract, abort.signal)).status,
    'failed',
  );
  assert.equal(calls, 1);
});
test('extraction defers guesses, rejects malformed output, and skips secret input', async (t) => {
  const { scope } = await setup(t);
  const signal = new AbortController().signal;
  const run = (turnId: string, text: string) =>
    extractMemory({ ...scope, turnId }, async () => text, signal);
  assert.equal(
    (await run('guess', JSON.stringify([{ ...candidate(), content: 'Use yarn.' }]))).status,
    'skipped',
  );
  assert.equal((await run('broken', '{')).status, 'failed');
  assert.equal(
    (await run('many', JSON.stringify(Array.from({ length: 6 }, () => candidate())))).status,
    'failed',
  );
  assert.equal(
    (
      await extractMemory(
        { ...scope, turnId: 'secret', sources: () => [{ id: 'user', text: 'api_key=private' }] },
        async () => {
          throw Error('Must not call');
        },
        signal,
      )
    ).status,
    'skipped',
  );
});

test('an interrupted atomic write preserves the previous file and cleans its temporary file', async (t) => {
  const { root, scope, memory } = await setup(t);
  const original = await memory.upsert(candidate());
  if (original.status !== 'saved') throw Error('Expected save');
  const { ManagedMemory: FailingMemory } = backendLoader({
    'node:fs/promises': {
      ...filesystem,
      rename: async () => {
        throw Object.assign(Error('Disk is read-only'), { code: 'EROFS' });
      },
    },
  })('electron/storage/managed-memory.ts');
  await assert.rejects(
    new FailingMemory(scope).upsert({
      ...candidate('Use npm run build.'),
      id: original.entry.id,
      expectedRevision: original.entry.revision,
    }),
    /read-only/,
  );
  assert.equal((await memory.read(original.entry.id)).content, 'Use npm test.');
  assert.equal(
    (await readdir(join(root, 'memory'))).some((name) => name.endsWith('.tmp')),
    false,
  );
});

test('missing indexes and metadata edits cannot retain verified provenance', async (t) => {
  const { root, memory } = await setup(t);
  const saved = await memory.upsert(candidate());
  if (saved.status !== 'saved') throw Error('Expected save');
  const file = join(root, 'memory', saved.entry.id + '.md');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('"topic":"Tests"', '"topic":"Unverified edit"'));
  assert.equal((await memory.read(saved.entry.id)).provenance, 'external');
  await writeFile(file, original);
  await rm(join(root, 'memory', '.managed-index.json'));
  assert.equal((await memory.read(saved.entry.id)).provenance, 'external');
  assert.equal((await memory.upsert(candidate())).status, 'deferred');
  await writeFile(file, '<!-- kalkidan-memory {');
  await assert.rejects(memory.list(), /Truncated/);
});

test('retrieval caps both entry count and excerpt characters', async (t) => {
  const { scope } = await setup(t);
  const facts = Array.from({ length: 4 }, (_, i) => `Fact ${i}: ` + 'x'.repeat(1900));
  scope.sources = () => facts.map((text, i) => ({ id: String(i), text }));
  const memory = new ManagedMemory(scope);
  for (const [i, content] of facts.entries())
    await memory.upsert({
      topic: 'Fact',
      content,
      references: [{ id: String(i), quote: content }],
    });
  const results = await memory.search('Fact');
  assert.equal(results.length, 3);
  assert.ok(results.reduce((size, item) => size + item.excerpt.length, 0) <= 4800);
});

test('the user saves and edits memory entries that agents read as trusted entries', async (t) => {
  const { root, scope } = await setup(t);
  const { projectMemory } = await import('../electron/storage/managed-memory');
  const user = projectMemory(root);
  await assert.rejects(user.save({ topic: '', content: 'x' }), /topic of up to 120/);
  await assert.rejects(user.save({ topic: 'T', content: 'x'.repeat(2001) }), /2,000 characters/);
  await assert.rejects(
    user.save({ id: 'a'.repeat(64), topic: 'T', content: 'x' }),
    /topic of up to 120/,
    'An edit needs the revision that the user saw',
  );
  assert.equal(
    (await user.save({ topic: 'Keys', content: 'password: hunter2' })).status,
    'deferred',
  );
  const saved = await user.save({ topic: ' Releases ', content: ' Tag releases from main. ' });
  assert.equal(saved.status, 'saved');
  if (saved.status !== 'saved') return;
  assert.equal(saved.entry.provenance, 'user');
  assert.equal(saved.entry.topic, 'Releases');
  assert.deepEqual(saved.entry.source, { sessionId: '', turnId: '', references: [] });
  // The index keeps the provenance when the entry loads again.
  const [loaded] = await user.list();
  assert.equal(loaded.provenance, 'user');
  assert.equal(loaded.revision, saved.entry.revision);
  assert.equal(
    (await user.save({ topic: 'Other', content: 'tag releases from MAIN.' })).status,
    'duplicate',
  );
  // An edit with an old revision is a conflict. The current revision saves.
  const stale = await user.save({
    id: saved.entry.id,
    expectedRevision: 'b'.repeat(64),
    topic: 'Releases',
    content: 'Tag releases from the release branch.',
  });
  assert.deepEqual(stale, {
    status: 'conflict',
    id: saved.entry.id,
    revision: saved.entry.revision,
  });
  const edited = await user.save({
    id: saved.entry.id,
    expectedRevision: saved.entry.revision,
    topic: 'Releases',
    content: 'Tag releases from the release branch.',
  });
  assert.equal(edited.status, 'saved');
  if (edited.status !== 'saved') return;
  assert.equal(edited.entry.id, saved.entry.id);
  assert.equal(edited.entry.createdAt, saved.entry.createdAt);
  // Agents find the user entry and treat it as trusted: no review for the same fact.
  const agent = new ManagedMemory({
    ...scope,
    sources: () => [{ id: 'user', text: 'Tag releases from the release branch.' }],
  });
  assert.equal((await agent.search('release branch'))[0]?.provenance, 'user');
  const again = await agent.upsert({
    topic: 'Releases',
    content: 'Tag releases from the release branch.',
    references: [{ id: 'user', quote: 'Tag releases from the release branch.' }],
  });
  assert.equal(again.status, 'duplicate');
  // Forget works for a user entry as for any entry.
  await user.forget(edited.entry.id, edited.entry.revision);
  assert.deepEqual(await user.list(), []);
});
