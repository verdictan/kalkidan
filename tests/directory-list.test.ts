import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDirectory } from '../electron/storage/directory-list';

test('directory listing includes files, hidden folders, and symlinks and validates navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-folders-'));
  try {
    await mkdir(join(root, 'docs'));
    await mkdir(join(root, '.hidden'));
    await writeFile(join(root, 'notes.md'), 'hello');
    await symlink(join(root, 'docs'), join(root, 'linked'));
    const listing = await listDirectory(root);
    assert.deepEqual(
      listing.entries.map((e) => [e.name, e.kind]),
      [
        ['.hidden', 'directory'],
        ['docs', 'directory'],
        ['linked', 'symlink'],
        ['notes.md', 'file'],
      ],
    );
    assert.equal((await listDirectory(join(root, 'linked'))).path, join(listing.path, 'docs'));
    await assert.rejects(listDirectory(join(root, 'notes.md')), /Choose a folder/);
    await assert.rejects(listDirectory('relative'), /absolute path/);
    await assert.rejects(listDirectory(join(root, 'missing')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
