import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resourceRevision } from '../electron/storage/resource-revision';

test('resource revisions detect additions, edits, moves, and deletion without reading bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-revision-'));
  try {
    assert.equal(await resourceRevision(root, 'memory'), 'missing');
    await mkdir(join(root, 'memory'));
    const empty = await resourceRevision(root, 'memory');
    assert.equal(await resourceRevision(root, 'memory'), empty);
    await writeFile(join(root, 'memory', 'one.md'), 'Reusable knowledge');
    const first = await resourceRevision(root, 'memory');
    assert.notEqual(first, empty);
    assert.equal(await resourceRevision(root, 'memory'), first);
    await writeFile(join(root, 'memory', 'one.md'), 'Updated knowledge with another fact');
    const edited = await resourceRevision(root, 'memory');
    assert.notEqual(edited, first);
    await rename(join(root, 'memory', 'one.md'), join(root, 'memory', 'two.md'));
    assert.notEqual(await resourceRevision(root, 'memory'), edited);
    await symlink(join(root, 'memory', 'two.md'), join(root, 'memory', 'linked.md'));
    const link = await resourceRevision(root, 'memory');
    assert.notEqual(link, edited);
    await rm(join(root, 'memory'), { recursive: true });
    assert.equal(await resourceRevision(root, 'memory'), 'missing');
    await mkdir(join(root, 'other'));
    await symlink(join(root, 'other'), join(root, 'docs'));
    await assert.rejects(resourceRevision(root, 'docs'), /symbolic link/);
    await assert.rejects(resourceRevision(root, '../outside' as any), /Invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
