import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  changedLines,
  codeFileChanges,
  codeFileRevision,
  listCodeFiles,
  readCodeFile,
  searchCode,
  writeCodeFile,
} from '../electron/code-files';
import { cleanCodePath, codeFileLimits } from '../src/domain/code-files';

const exec = promisify(execFile);
const windows = process.platform === 'win32';

async function folder(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function withFolders(run: (root: string, outside: string) => Promise<void>) {
  const root = await folder('code-root-');
  const outside = await folder('code-outside-');
  try {
    await run(root, outside);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

async function gitInit(root: string) {
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  await exec('git', ['-C', root, 'config', 'user.name', 'Test']);
  await exec('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
}

test('a path must be relative, stay in the root and not be in .git', () => {
  assert.equal(cleanCodePath('src/app.ts'), 'src/app.ts');
  assert.equal(cleanCodePath('./src//app.ts'), 'src/app.ts');
  assert.equal(cleanCodePath('src\\app.ts'), 'src/app.ts');
  for (const bad of [
    '',
    '.',
    '/etc/passwd',
    '\\etc\\passwd',
    'C:\\Windows\\win.ini',
    'c:file',
    '../secret',
    'src/../../secret',
    'src\\..\\..\\secret',
    '.git/config',
    'sub/.GIT/hooks/pre-commit',
    'a\0b',
    'a'.repeat(codeFileLimits.path + 1),
    42,
    null,
  ])
    assert.equal(cleanCodePath(bad), null, String(bad));
});

test('a file in the repository reads as text with a revision', async () => {
  await withFolders(async (root) => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'app.ts'), 'export const a = 1;\n');
    const file = await readCodeFile(root, 'src/app.ts');
    assert.equal(file.path, 'src/app.ts');
    assert.equal(file.content, 'export const a = 1;\n');
    assert.equal(file.size, 20);
    assert.match(file.revision, /^[0-9a-f]{64}$/);
    assert.equal(await codeFileRevision(root, 'src/app.ts'), file.revision);
    assert.equal(await codeFileRevision(root, 'src/gone.ts'), null);
  });
});

test('paths that go out of the root, absolute paths and .git are refused', async () => {
  await withFolders(async (root, outside) => {
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), '[core]\n');
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await writeFile(join(root, 'ok.txt'), 'ok');
    for (const path of [
      '../' + outside.split(/[\\/]/).pop() + '/secret.txt',
      join(outside, 'secret.txt'),
      '.git/config',
    ]) {
      await assert.rejects(readCodeFile(root, path), /outside the repository/);
      await assert.rejects(writeCodeFile(root, path, 'x', 'r'), /outside the repository/);
    }
    // A relative root is refused.
    await assert.rejects(readCodeFile('relative/root', 'ok.txt'), /Choose a repository/);
    await assert.rejects(readCodeFile(root, 'missing.txt'), /not found/);
    await assert.rejects(readCodeFile(root, '.'), /outside the repository/);
  });
});

test('a symbolic link out of the repository is never followed', { skip: windows }, async () => {
  await withFolders(async (root, outside) => {
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await mkdir(join(outside, 'dir'));
    await writeFile(join(outside, 'dir', 'inner.txt'), 'inner');
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));
    await symlink(join(outside, 'dir'), join(root, 'linked-dir'));
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), '[core]\n');
    await symlink(join(root, '.git'), join(root, 'git-alias'));
    for (const path of ['link.txt', 'linked-dir/inner.txt', 'git-alias/config']) {
      await assert.rejects(readCodeFile(root, path), /outside the repository/, path);
      await assert.rejects(codeFileRevision(root, path), /outside the repository/, path);
      await assert.rejects(writeCodeFile(root, path, 'changed', 'x'), /outside/, path);
      await assert.rejects(codeFileChanges(root, path), /outside the repository/, path);
    }
    assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'secret');
    // A link that stays in the repository is allowed.
    await writeFile(join(root, 'real.txt'), 'real');
    await symlink(join(root, 'real.txt'), join(root, 'alias.txt'));
    assert.equal((await readCodeFile(root, 'alias.txt')).content, 'real');
  });
});

test('a root that is a link resolves to its real folder', { skip: windows }, async () => {
  await withFolders(async (root, outside) => {
    await writeFile(join(root, 'a.txt'), 'a');
    const alias = join(outside, 'alias');
    await symlink(root, alias);
    assert.equal((await readCodeFile(alias, 'a.txt')).content, 'a');
  });
});

test('large and binary files give a note instead of text', async () => {
  await withFolders(async (root) => {
    await writeFile(join(root, 'big.txt'), Buffer.alloc(codeFileLimits.readBytes + 1, 97));
    await writeFile(join(root, 'image.bin'), Buffer.from([1, 2, 0, 3]));
    const big = await readCodeFile(root, 'big.txt');
    assert.equal(big.note, 'too-large');
    assert.equal(big.content, undefined);
    const binary = await readCodeFile(root, 'image.bin');
    assert.equal(binary.note, 'binary');
    assert.equal(binary.content, undefined);
    await assert.rejects(writeCodeFile(root, 'big.txt', 'x', big.revision), /too large/);
  });
});

test('a folder or a pipe is not opened as a file', { skip: windows }, async () => {
  await withFolders(async (root) => {
    await mkdir(join(root, 'src'));
    await assert.rejects(readCodeFile(root, 'src'), /not a file/);
    await exec('mkfifo', [join(root, 'pipe')]);
    await assert.rejects(readCodeFile(root, 'pipe'), /not a file/);
    await assert.rejects(writeCodeFile(root, 'pipe', 'x', 'r'), /not a file/);
  });
});

test('a save writes only the revision that the editor opened', async () => {
  await withFolders(async (root) => {
    await writeFile(join(root, 'a.ts'), 'one\n');
    const opened = await readCodeFile(root, 'a.ts');
    const saved = await writeCodeFile(root, 'a.ts', 'two\n', opened.revision);
    assert.equal(saved.ok, true);
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'two\n');
    assert.equal(saved.ok && saved.revision, (await readCodeFile(root, 'a.ts')).revision);
    // A shorter text truncates the file.
    const shorter = await writeCodeFile(root, 'a.ts', 'x', saved.ok ? saved.revision : '');
    assert.equal(shorter.ok, true);
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'x');
    // The agent changed the file after the editor opened it: a conflict, nothing is written.
    await writeFile(join(root, 'a.ts'), 'agent\n');
    const conflict = await writeCodeFile(root, 'a.ts', 'mine\n', opened.revision);
    assert.equal(conflict.ok, false);
    assert.equal(!conflict.ok && conflict.revision, (await readCodeFile(root, 'a.ts')).revision);
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'agent\n');
    // A file that is gone is a conflict with no revision. Save never creates a file.
    const gone = await writeCodeFile(root, 'new.ts', 'x', opened.revision);
    assert.deepEqual(gone, { ok: false, conflict: true, revision: null });
    await assert.rejects(readCodeFile(root, 'new.ts'), /not found/);
  });
});

test('a save checks the text and its size', async () => {
  await withFolders(async (root) => {
    await writeFile(join(root, 'a.ts'), 'one');
    const { revision } = await readCodeFile(root, 'a.ts');
    await assert.rejects(writeCodeFile(root, 'a.ts', 42, revision), /not valid/);
    await assert.rejects(writeCodeFile(root, 'a.ts', 'x', ''), /Open the file again/);
    await assert.rejects(
      writeCodeFile(root, 'a.ts', 'é'.repeat(codeFileLimits.writeBytes / 2 + 1), revision),
      /too large/,
    );
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'one');
  });
});

test('a file with a second hard link out of the repository is not saved', async () => {
  await withFolders(async (root, outside) => {
    await writeFile(join(outside, 'shared.txt'), 'shared');
    await link(join(outside, 'shared.txt'), join(root, 'shared.txt'));
    const { revision } = await readCodeFile(root, 'shared.txt');
    await assert.rejects(writeCodeFile(root, 'shared.txt', 'changed', revision), /more than one/);
    assert.equal(await readFile(join(outside, 'shared.txt'), 'utf8'), 'shared');
  });
});

test('the file list has repository files and no .git files', async () => {
  await withFolders(async (root) => {
    await gitInit(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.ts'), 'a');
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(root, 'ignored.txt'), 'x');
    const list = await listCodeFiles(root);
    assert.deepEqual([...list.files].sort(), ['.gitignore', 'src/a.ts']);
    assert.equal(list.truncated, false);
  });
});

test('changed lines come from the diff with the last commit', async () => {
  await withFolders(async (root) => {
    await gitInit(root);
    await writeFile(join(root, 'a.ts'), 'one\ntwo\nthree\nfour\n');
    await exec('git', ['-C', root, 'add', '.']);
    await exec('git', ['-C', root, 'commit', '-q', '-m', 'first']);
    await writeFile(join(root, 'a.ts'), 'one\nTWO\nthree\nfour\nfive\nsix\n');
    assert.deepEqual(await codeFileChanges(root, 'a.ts'), {
      path: 'a.ts',
      lines: [2, 5, 6],
      untracked: false,
    });
    await writeFile(join(root, 'new.ts'), 'a\nb\n');
    assert.deepEqual(await codeFileChanges(root, 'new.ts'), {
      path: 'new.ts',
      lines: [1, 2],
      untracked: true,
    });
  });
});

test('a folder without Git gives all lines as changed', async () => {
  await withFolders(async (root) => {
    await writeFile(join(root, 'a.ts'), 'a\nb\nc');
    assert.deepEqual((await codeFileChanges(root, 'a.ts')).lines, [1, 2, 3]);
  });
});

test('the diff parser reads hunk starts and counts', () => {
  const diff = ['@@ -1 +1 @@', '-a', '+b', '@@ -3,0 +4,2 @@', '+c', '+d', '@@ -9,2 +11,0 @@'];
  assert.deepEqual(changedLines(diff.join('\n')), [1, 4, 5]);
});

test('search finds text in tracked and new files, with smart case', async () => {
  await withFolders(async (root) => {
    await gitInit(root);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'session.ts'), 'export function session() {}\n// Session\n');
    await writeFile(join(root, 'notes.md'), 'no match\nthe session ends\n');
    await writeFile(join(root, 'bin.dat'), Buffer.from([115, 101, 115, 115, 0, 105]));
    await exec('git', ['-C', root, 'add', 'src/session.ts']);
    const lower = await searchCode(root, 'session');
    assert.deepEqual(lower.matches.map((m) => `${m.path}:${m.line}:${m.column}`).sort(), [
      'notes.md:2:5',
      'src/session.ts:1:17',
      'src/session.ts:2:4',
    ]);
    const upper = await searchCode(root, 'Session');
    assert.deepEqual(
      upper.matches.map((m) => `${m.path}:${m.line}`),
      ['src/session.ts:2'],
    );
    // The query is a fixed text, not a pattern or an option.
    assert.deepEqual((await searchCode(root, '.*')).matches, []);
    assert.deepEqual((await searchCode(root, '--help')).matches, []);
    await assert.rejects(searchCode(root, '   '), /Type the text/);
    await assert.rejects(searchCode(root, 'x'.repeat(codeFileLimits.query + 1)), /Type the text/);
  });
});

test('search stops at the match limit and works without Git', async () => {
  await withFolders(async (root) => {
    await writeFile(join(root, 'many.txt'), 'hit\n'.repeat(codeFileLimits.matches + 20));
    await writeFile(join(root, 'big.txt'), 'hit\n'.repeat(codeFileLimits.searchFileBytes / 2));
    const result = await searchCode(root, 'hit');
    assert.equal(result.matches.length, codeFileLimits.matches);
    assert.equal(result.truncated, true);
  });
});

test('search without Git skips large files and links out of the root', async () => {
  await withFolders(async (root, outside) => {
    await writeFile(join(root, 'big.txt'), 'hit\n'.repeat(codeFileLimits.searchFileBytes / 2));
    await writeFile(join(root, 'small.txt'), 'one hit\n');
    await writeFile(join(outside, 'secret.txt'), 'hit secret\n');
    if (!windows) await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));
    const result = await searchCode(root, 'hit');
    assert.deepEqual(result.matches, [{ path: 'small.txt', line: 1, column: 5, text: 'one hit' }]);
  });
});
