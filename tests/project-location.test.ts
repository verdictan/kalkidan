import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  prepareProjectLocation,
  legacyDocs,
  importLegacyDocs,
} from '../electron/storage/project-location';
import { ProjectDocs } from '../electron/storage/project-docs';

test('project roots isolate data, preserve legacy revisions, and reject collisions', async () => {
  const base = await mkdtemp(join(tmpdir(), 'project-location-'));
  try {
    const root = await prepareProjectLocation('atlas', undefined, base);
    assert.deepEqual((await readdir(root)).sort(), [
      '.kalkidan-project',
      'docs',
      'repos',
      'worktrees',
    ]);
    assert.equal(await prepareProjectLocation('atlas', root, base), root);
    await assert.rejects(prepareProjectLocation('other', root, base), /another project/);
    await assert.rejects(prepareProjectLocation('other', 'relative', base), /absolute/);
    await mkdir(join(base, 'existing'));
    await writeFile(join(base, 'existing', 'keep.txt'), 'keep');
    await assert.rejects(
      prepareProjectLocation('other', join(base, 'existing'), base),
      /empty folder/,
    );
    const old = new ProjectDocs(join(base, 'legacy'), (id) => id === 'atlas');
    const page = await old.create('atlas', 'Guide', null);
    const removed = await old.create('atlas', 'Removed', null);
    await old.delete('atlas', removed.id, removed.revision);
    const files = await legacyDocs(join(base, 'legacy', 'atlas'));
    await importLegacyDocs(root, files);
    await importLegacyDocs(root, files);
    const current = new ProjectDocs(
      base,
      (id) => id === 'atlas',
      async () => join(root, 'docs'),
    );
    // The import copies the files, so the change time is the time of the copy.
    const withoutTime = ({ updatedAt: _time, ...rest }: { updatedAt?: number }) => rest;
    assert.deepEqual((await current.list('atlas')).map(withoutTime), [withoutTime(page)]);
    assert.equal((await readdir(join(root, 'docs', '.trash'))).length, 1);
    await current.save('atlas', { ...page, markdown: 'New location' });
    assert.equal((await old.list('atlas'))[0].markdown, '');
    await assert.rejects(importLegacyDocs(root, files), /conflict/);
    await assert.rejects(
      importLegacyDocs(root, [{ name: '../escape.md', content: '' }]),
      /Invalid/,
    );
    const linked = join(base, 'linked');
    await symlink(root, linked);
    await assert.rejects(prepareProjectLocation('atlas', linked, base), /symbolic link/);
    assert.equal(await readFile(join(base, 'existing', 'keep.txt'), 'utf8'), 'keep');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
