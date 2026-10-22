import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkingStatus, parseWorkingFiles } from '../electron/git-working';

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
