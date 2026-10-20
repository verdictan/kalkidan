import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectDocs } from '../electron/storage/project-docs';

test('project wiki persists Markdown, hierarchy, conflicts, and recoverable deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-docs-'));
  try {
    const store = new ProjectDocs(root, (id) => ['atlas', 'other'].includes(id));
    const parent = await store.create('atlas', 'Guide', null);
    let child = await store.create('atlas', 'Setup', parent.id);
    child = await store.save('atlas', {
      ...child,
      markdown: '# Hello\n\n**World**',
      title: 'Install',
    });
    assert.match(await readFile(join(root, 'atlas', child.id + '.md'), 'utf8'), /# Hello/);
    const restored = new ProjectDocs(root, () => true);
    assert.equal(
      (await restored.list('atlas')).find((p) => p.id === child.id)?.parentId,
      parent.id,
    );
    assert.deepEqual(await store.list('other'), []);
    await assert.rejects(store.save('atlas', { ...parent, parentId: child.id }), /nested/);
    await assert.rejects(store.delete('atlas', parent.id, parent.revision), /child pages/);
    const path = join(root, 'atlas', child.id + '.md');
    await writeFile(path, (await readFile(path, 'utf8')) + '\nExternal edit');
    await assert.rejects(store.save('atlas', child), /changed on disk/);
    child = (await store.list('atlas')).find((p) => p.id === child.id)!;
    await store.delete('atlas', child.id, child.revision);
    assert.equal((await store.list('atlas')).length, 1);
    assert.equal((await readdir(join(root, 'atlas', '.trash'))).length, 1);
    await assert.rejects(store.list('../outside'), /Project not found/);
    await assert.rejects(store.create('missing', 'No', null), /Project not found/);
    await assert.rejects(store.create('atlas', 'Bad', '../outside'), /Invalid page ID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('docs selection picks the parent, a previous sibling, or the first page', async () => {
  const { pageAfterDelete, initialPage } = await import('../src/components/project-docs');
  const pages = [
    { id: 'b', title: 'Beta', parentId: null },
    { id: 'a', title: 'Alpha', parentId: null },
    { id: 'c', title: 'Child', parentId: 'b' },
    { id: 'd', title: 'Delta', parentId: null },
  ];
  assert.equal(pageAfterDelete(pages, 'c'), 'b');
  assert.equal(pageAfterDelete(pages, 'd'), 'b');
  assert.equal(pageAfterDelete(pages, 'a'), 'b');
  assert.equal(pageAfterDelete([pages[1]], 'a'), '');
  assert.equal(initialPage(pages, 'c'), 'c');
  assert.equal(initialPage(pages, 'missing'), 'b');
  assert.equal(initialPage([], null), '');
});

test('deleted pages can be listed and restored, and orphans go to the top level', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-docs-trash-'));
  try {
    const store = new ProjectDocs(root, (id) => id === 'atlas');
    assert.deepEqual(await store.trash('atlas'), []);
    const parent = await store.create('atlas', 'Guide', null);
    const child = await store.create('atlas', 'Setup', parent.id);
    await store.delete('atlas', child.id, child.revision);
    const guide = (await store.list('atlas'))[0];
    await store.delete('atlas', guide.id, guide.revision);
    const trash = await store.trash('atlas');
    assert.deepEqual(trash.map((d) => d.title).sort(), ['Guide', 'Setup']);
    const setup = trash.find((d) => d.title === 'Setup')!;
    const restored = await store.restore('atlas', setup.trashId);
    assert.equal(restored.id, child.id);
    assert.equal(restored.parentId, null);
    assert.deepEqual(
      (await store.list('atlas')).map((p) => p.title),
      ['Setup'],
    );
    assert.equal((await store.trash('atlas')).length, 1);
    await assert.rejects(store.restore('atlas', '../escape-1'), /Invalid deleted page/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('page order persists in the page header and in the metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-docs-order-'));
  try {
    const store = new ProjectDocs(root, () => true);
    const first = await store.create('atlas', 'First', null);
    const second = await store.create('atlas', 'Second', null);
    assert.equal(first.order, undefined);
    const saved = await store.save('atlas', { ...second, order: 0 });
    assert.equal(saved.order, 0);
    assert.match(await readFile(join(root, 'atlas', second.id + '.md'), 'utf8'), /"order":0/);
    const fresh = new ProjectDocs(root, () => true);
    assert.equal((await fresh.get('atlas', second.id)).order, 0);
    const metadata = await fresh.metadata('atlas');
    assert.equal(metadata.find((p) => p.id === second.id)?.order, 0);
    assert.equal('order' in metadata.find((p) => p.id === first.id)!, false);
    const cleared = await fresh.save('atlas', { ...saved, order: undefined });
    assert.equal('order' in cleared, false);
    assert.doesNotMatch(await readFile(join(root, 'atlas', second.id + '.md'), 'utf8'), /order/);
    const invalid = await fresh.save('atlas', { ...cleared, order: Number.NaN });
    assert.equal('order' in invalid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('docs sort sibling pages by order, then by title, and list the tree in order', async () => {
  const { sortedSiblings, docTreeOrder } = await import('../src/components/project-docs');
  const pages = [
    { id: 'b', title: 'Beta', parentId: null },
    { id: 'a', title: 'Alpha', parentId: null },
    { id: 'z', title: 'Zulu', parentId: null, order: 0 },
    { id: 'c', title: 'Child', parentId: 'a' },
  ];
  assert.deepEqual(
    sortedSiblings(pages, null).map((p) => p.id),
    ['z', 'a', 'b'],
  );
  assert.deepEqual(
    docTreeOrder(pages).map(({ page, depth }) => `${page.id}:${depth}`),
    ['z:0', 'a:0', 'c:1', 'b:0'],
  );
});
