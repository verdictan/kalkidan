import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectDocs } from '../electron/storage/project-docs';
import { ProjectLocationCache } from '../electron/storage/project-location';
import { history, historyMetrics } from '../electron/history';

test('ordinary saves read one document, metadata omits bodies, cached reads detect external changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-io-'));
  try {
    const store = new ProjectDocs(root, () => true);
    const docs = [];
    for (let i = 0; i < 100; i++) {
      let doc = await store.create('project', 'Page ' + i, null);
      doc = await store.save('project', { ...doc, markdown: 'Content '.repeat(1000) });
      docs.push(doc);
    }
    const cold = new ProjectDocs(root, () => true);
    const saved = await cold.save('project', { ...docs[0], markdown: 'Changed' });
    assert.equal(cold.metrics.bodyReads, 1);
    const metadata = await cold.metadata('project');
    assert.equal(metadata.length, 100);
    assert.ok(metadata.every((doc) => !('markdown' in doc)));
    assert.equal(cold.metrics.bodyReads, 1);
    assert.equal(cold.metrics.headerReads, 100);
    await cold.metadata('project');
    assert.equal(cold.metrics.headerReads, 100);
    const document = await cold.get('project', saved.id);
    const reads = cold.metrics.bodyReads;
    await cold.get('project', saved.id);
    assert.equal(cold.metrics.bodyReads, reads);
    const file = join(root, 'project', saved.id + '.md');
    await writeFile(file, (await readFile(file, 'utf8')) + '\nExternal edit');
    await assert.rejects(cold.save('project', document), /changed on disk/);
    assert.match((await cold.get('project', saved.id)).markdown, /External edit/);
    const fullBytes = Buffer.byteLength(JSON.stringify(docs));
    const metadataBytes = Buffer.byteLength(JSON.stringify(metadata));
    assert.ok(metadataBytes < fullBytes / 20);
    console.log(JSON.stringify({ documents: 100, coldSaveBodyReads: 1, fullBytes, metadataBytes }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project queues isolate slow projects but serialize same-project changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'docs-queues-'));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const store = new ProjectDocs(
    root,
    () => true,
    async (id) => {
      if (id === 'slow') {
        order.push('slow');
        await blocked;
      }
      return join(root, id);
    },
  );
  try {
    const first = store.create('slow', 'First', null);
    const second = store.create('slow', 'Second', null);
    const fast = await store.create('fast', 'Independent', null);
    assert.equal(fast.title, 'Independent');
    assert.deepEqual(order, ['slow']);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['slow', 'slow']);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

test('history parses changed files only and retains source mappings on cache hits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-io-'));
  const codex = join(root, 'codex'),
    claude = join(root, 'claude');
  try {
    const dir = join(claude, 'projects', 'test');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'session.jsonl');
    const row = (title: string) =>
      JSON.stringify({ type: 'user', cwd: root, sessionId: 'one', message: { content: title } }) +
      '\n';
    await writeFile(path, row('First'));
    const start = historyMetrics.parsedFiles;
    await history(codex, claude);
    assert.equal(historyMetrics.parsedFiles, start + 1);
    const sources = new Map<string, string>();
    const cached = await history(codex, claude, sources);
    assert.equal(historyMetrics.parsedFiles, start + 1);
    assert.equal(cached.sessions[0].title, 'First');
    assert.equal(sources.get('claude:one'), path);
    await writeFile(path, row('Second external edit'));
    const changed = await history(codex, claude);
    assert.equal(historyMetrics.parsedFiles, start + 2);
    assert.equal(changed.sessions[0].title, 'Second external edit');
    await rm(path);
    assert.equal((await history(codex, claude)).sessions.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project initialization is shared, cached, and invalidated without caching failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-cache-'));
  try {
    const cache = new ProjectLocationCache(root);
    await Promise.all([cache.get('one'), cache.get('one')]);
    await cache.get('one');
    assert.equal(cache.metrics.preparations, 1);
    cache.invalidate('one');
    await cache.get('one');
    assert.equal(cache.metrics.preparations, 2);
    await assert.rejects(cache.get('one', 'relative'));
    await assert.rejects(cache.get('one', 'relative'));
    assert.equal(cache.metrics.preparations, 4);
    const reconnect = new ProjectLocationCache(root);
    await reconnect.get('one');
    assert.equal(reconnect.metrics.preparations, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
