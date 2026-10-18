import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffFiles } from '../src/lib/diff-files';
test('file review handles spaces, deletion and rename without counting headers', () => {
  const files = diffFiles(
    'diff --git a/a file.ts b/a file.ts\n--- a/a file.ts\n+++ b/a file.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/gone b/gone\n--- a/gone\n+++ /dev/null\n-deleted\ndiff --git a/before b/after\nsimilarity index 100%\nrename from before\nrename to after\n',
  );
  assert.deepEqual(
    files.map(({ path, added, removed }) => ({ path, added, removed })),
    [
      { path: 'a file.ts', added: 1, removed: 1 },
      { path: 'gone', added: 0, removed: 1 },
      { path: 'after', added: 0, removed: 0 },
    ],
  );
  assert.deepEqual(diffFiles(''), []);
});
