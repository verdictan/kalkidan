import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { listMentionFiles, readMentionFile } from '../electron/projects/mention-files';
import { mentionLimits } from '../src/domain/mentions';

const exec = promisify(execFile);

async function folder(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

test('a Git folder lists tracked and new files, without ignored files', async () => {
  const root = await folder('mention-git-');
  try {
    await exec('git', ['init', '-q', root]);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, '.gitignore'), 'secret.txt\n');
    await writeFile(join(root, 'src', 'app.ts'), 'export {};\n');
    await writeFile(join(root, 'secret.txt'), 'no');
    await exec('git', ['-C', root, 'add', 'src/app.ts', '.gitignore']);
    await writeFile(join(root, 'notes.md'), '# Notes');
    const list = await listMentionFiles(root);
    assert.deepEqual([...list.files].sort(), ['.gitignore', 'notes.md', 'src/app.ts']);
    assert.equal(list.truncated, false);
    const limited = await listMentionFiles(root, 2);
    assert.equal(limited.files.length, 2);
    assert.equal(limited.truncated, true);
    // A subfolder lists its own files, relative to the subfolder.
    assert.deepEqual((await listMentionFiles(join(root, 'src'))).files, ['app.ts']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a folder without Git gives a bounded walk that skips hidden and dependency folders', async () => {
  const root = await folder('mention-walk-');
  try {
    await mkdir(join(root, 'lib', 'deep'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'x'), { recursive: true });
    await mkdir(join(root, '.cache'));
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'lib', 'b.txt'), 'b');
    await writeFile(join(root, 'lib', 'deep', 'c.txt'), 'c');
    await writeFile(join(root, 'node_modules', 'x', 'd.js'), 'd');
    await writeFile(join(root, '.cache', 'e'), 'e');
    await writeFile(join(root, '.env'), 'f');
    // The temporary folder is not a Git repository, so Kalkidan walks the folder.
    const list = await listMentionFiles(root);
    assert.deepEqual(list.files, ['a.txt', 'lib/b.txt', 'lib/deep/c.txt']);
    assert.equal(list.truncated, false);
    const limited = await listMentionFiles(root, 1);
    assert.deepEqual(limited, { files: ['a.txt'], truncated: true });
    await assert.rejects(listMentionFiles('relative/path'), /Choose a code folder/);
    await assert.rejects(listMentionFiles(join(root, 'a.txt')), /not a folder/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a mentioned file must stay in the folder and is bounded by size and type', async () => {
  const parent = await folder('mention-read-');
  const root = join(parent, 'repo');
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(parent, 'outside.txt'), 'secret');
    await writeFile(join(root, 'src', 'small.ts'), 'const a = 1;\n');
    await writeFile(join(root, 'long.txt'), 'x'.repeat(mentionLimits.fileCharacters + 10));
    await writeFile(join(root, 'big.bin'), Buffer.alloc(mentionLimits.fileBytes + 1, 65));
    await writeFile(join(root, 'image.png'), Buffer.from([137, 80, 0, 1]));
    await symlink(join(parent, 'outside.txt'), join(root, 'escape.txt'));
    await symlink(join(root, 'src', 'small.ts'), join(root, 'inside.ts'));
    assert.deepEqual(await readMentionFile(root, 'src/small.ts'), {
      path: 'src/small.ts',
      size: 13,
      content: 'const a = 1;\n',
    });
    assert.equal((await readMentionFile(root, 'inside.ts')).content, 'const a = 1;\n');
    const long = await readMentionFile(root, 'long.txt');
    assert.equal(long.content!.length, mentionLimits.fileCharacters);
    assert.equal(long.truncated, true);
    const big = await readMentionFile(root, 'big.bin');
    assert.equal(big.content, undefined);
    assert.match(big.note!, /too large/);
    assert.match((await readMentionFile(root, 'image.png')).note!, /Binary/);
    for (const path of ['../outside.txt', 'src/../../outside.txt', join(parent, 'outside.txt')])
      await assert.rejects(readMentionFile(root, path), /outside the code folder/);
    await assert.rejects(readMentionFile(root, 'escape.txt'), /outside the code folder/);
    await assert.rejects(readMentionFile(root, ''), /outside the code folder/);
    await assert.rejects(readMentionFile(root, 'a\0b'), /outside the code folder/);
    await assert.rejects(readMentionFile(root, 'C:/x'), /outside the code folder/);
    await assert.rejects(readMentionFile(root, 'src'), /not a file/);
    await assert.rejects(readMentionFile(root, 'missing.ts'), /ENOENT/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
