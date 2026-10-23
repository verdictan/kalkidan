export interface DiffFile {
  path: string;
  patch: string;
  added: number;
  removed: number;
}
function pathLabel(value: string) {
  try {
    if (value.startsWith('"')) value = JSON.parse(value);
  } catch {
    /* Keep unusual Git path quoting readable. */
  }
  return value.replace(/^[ab]\//, '');
}
/**
 * The line count of a whole new file ("@@ -0,0 +1,13 @@") or a whole removed file
 * ("@@ -1,13 +0,0 @@"). It stays right when a long diff is cut before the end of the file.
 */
function wholeFileCount(lines: string[], side: 'added' | 'removed') {
  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;
    const [oldStart, oldCount, newStart, newCount] = [hunk[1], hunk[2], hunk[3], hunk[4]].map(
      (value) => (value === undefined ? 1 : Number(value)),
    );
    if (side === 'added' && oldStart === 0 && oldCount === 0) return newCount;
    if (side === 'removed' && newStart === 0 && newCount === 0) return oldCount;
    return 0;
  }
  return 0;
}
export function diffFiles(patch: string): DiffFile[] {
  if (!patch.trim()) return [];
  return patch
    .split(/(?=^diff --git )/m)
    .filter((part) => part.trim())
    .map((part) => {
      const lines = part.split('\n');
      const next = lines.find((line) => line.startsWith('+++ ') && line !== '+++ /dev/null');
      const previous = lines.find((line) => line.startsWith('--- ') && line !== '--- /dev/null');
      const renamed = lines.find((line) => line.startsWith('rename to '));
      const header = lines[0].match(/ b\/(.+)$/)?.[1];
      const path =
        next || previous
          ? pathLabel((next || previous)!.slice(4).split('\t')[0])
          : renamed
            ? renamed.slice(10)
            : header || 'Changes';
      return {
        path,
        patch: part,
        added: Math.max(
          wholeFileCount(lines, 'added'),
          lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
        ),
        removed: Math.max(
          wholeFileCount(lines, 'removed'),
          lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
        ),
      };
    });
}
