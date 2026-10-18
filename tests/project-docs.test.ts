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
