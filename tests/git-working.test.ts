import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkingStatus, parseWorkingFiles } from '../electron/git-working';
import { readAppearanceMode, saveAppearanceMode, withScheme } from '../electron/storage/appearance';

test('parses porcelain v2 status with renames, conflicts, and untracked files', () => {
  const output = [
    '# branch.oid abc',
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +3 -1',
    '1 .M N... 100644 100644 100644 a b src/a.ts',
    '2 R. N... 100644 100644 100644 a b R100 src/new.ts',
    'src/old.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? notes.txt',
    '? other.txt',
    '! ignored.log',
    '',
  ].join('\0');
  assert.deepEqual(parseWorkingStatus(output), {
    branch: 'feature/x',
    upstream: true,
    ahead: 3,
    changed: 3,
    untracked: 2,
  });
  assert.equal(parseWorkingStatus('# branch.head (detached)\0').branch, 'HEAD');
});

test('appearance persists for the next start and sets the scheme of the start URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appearance-'));
  try {
    const file = join(root, 'appearance.json');
    assert.equal(await readAppearanceMode(file), 'system');
    await saveAppearanceMode(file, 'dark');
    assert.equal(await readAppearanceMode(file), 'dark');
    await writeFile(file, '{"mode":"sepia"}');
    assert.equal(await readAppearanceMode(file), 'system');
    await assert.rejects(saveAppearanceMode(file, 'sepia' as never), /Invalid appearance/);
    assert.equal(withScheme('http://127.0.0.1:5173', true), 'http://127.0.0.1:5173?scheme=dark');
    assert.equal(
      withScheme('file:///app/index.html', false, '#session=x'),
      'file:///app/index.html?scheme=light#session=x',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parses porcelain v1 file entries with renames, conflicts and untracked files', () => {
  const output = [
    ' M src/a.ts',
    'M  src/staged.ts',
    'A  added.ts',
    ' D gone.ts',
    'R  src/new.ts',
    'src/old.ts',
    'UU conflict.ts',
    'AA both-added.ts',
    '?? notes/new file.txt',
    '!! ignored.log',
    '',
  ].join('\0');
  assert.deepEqual(parseWorkingFiles(output), [
    { path: 'src/a.ts', status: 'modified' },
    { path: 'src/staged.ts', status: 'modified' },
    { path: 'added.ts', status: 'added' },
    { path: 'gone.ts', status: 'deleted' },
    { path: 'src/new.ts', status: 'renamed', from: 'src/old.ts' },
    { path: 'conflict.ts', status: 'conflicted' },
    { path: 'both-added.ts', status: 'conflicted' },
    { path: 'notes/new file.txt', status: 'untracked' },
  ]);
  assert.deepEqual(parseWorkingFiles(''), []);
});
