import { useEffect, useRef, useState, type ReactElement } from 'react';
import { File, FileCheck } from 'lucide-react';
import type { RepositoryDiff } from '../types';
import { diffFiles } from '../lib/diff-files';
import { EmptyState } from './ui/empty-state';
import { Hint } from './hint';
import { cn } from '../lib/utils';

/** Shows why an attach button is disabled. */
export function AttachHint({ reason, children }: { reason: string; children: ReactElement }) {
  return reason ? <Hint label={reason}>{children}</Hint> : children;
}

type DiffLineKind = 'header' | 'hunk' | 'add' | 'remove' | 'context';
interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

/** Splits a file patch into lines with old and new line numbers. */
function numberLines(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  // A patch ends with a newline. Do not show the empty last line as a context line.
  if (lines.at(-1) === '') lines.pop();
  // A new, untracked file has only added lines and no Git header.
  const plain = !lines.some((line) => line.startsWith('@@') || line.startsWith('diff --git'));
  let inHunk = plain;
  let oldNumber = 1;
  let newNumber = 1;
  return lines.map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      inHunk = true;
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      return { kind: 'hunk', text };
    }
    if (!inHunk || text.startsWith('diff --git')) {
      inHunk = false;
      return { kind: 'header', text };
    }
    if (text.startsWith('+')) return { kind: 'add', text, newNumber: newNumber++ };
    if (text.startsWith('-')) return { kind: 'remove', text, oldNumber: oldNumber++ };
    if (text.startsWith('\\')) return { kind: 'header', text };
    return { kind: 'context', text, oldNumber: oldNumber++, newNumber: newNumber++ };
  });
}
const signs: Partial<Record<DiffLineKind, string>> = { add: 'Added: ', remove: 'Removed: ' };
const lineClass: Record<DiffLineKind, string> = {
  header: 'diff-line diff-header',
  hunk: 'diff-line diff-location',
  add: 'diff-line diff-addition',
  remove: 'diff-line diff-deletion',
  context: 'diff-line',
};

/**
 * One diff block for steps, approvals and the Changes pane: one line-number column, the hunk
 * line, and green and red lines without the "+" and "−" marks (a screen reader hears "Added"
 * or "Removed"). The Git file header lines do not show. `framed` draws the 10px frame of a
 * code block. The Changes pane fills its edges.
 */
export function DiffBlock({
  patch,
  label = 'Git diff',
  framed = true,
  className,
}: {
  patch: string;
  label?: string;
  framed?: boolean;
  className?: string;
}) {
  return (
    <pre
      role="region"
      tabIndex={0}
      aria-label={label}
      className={cn('diff-block', framed && 'diff-block-framed', className)}
    >
      {patch
        ? numberLines(patch)
            .filter((line) => line.kind !== 'header')
            .map((line, index) => {
              const marked = line.kind === 'add' || line.kind === 'remove';
              const body = marked || line.kind === 'context' ? line.text.slice(1) : line.text;
              return (
                <span key={index} className={lineClass[line.kind]}>
                  <span className="diff-gutter" aria-hidden="true">
                    {line.newNumber ?? line.oldNumber ?? ''}
                  </span>
                  {signs[line.kind] && <span className="sr-only">{signs[line.kind]}</span>}
                  <span className="diff-text">{body}</span>
                  {'\n'}
                </span>
              );
            })
        : 'No text preview available.'}
    </pre>
  );
}

/** True when a step output or an approval detail is a patch. */
export function isPatch(text: string) {
  return /^(diff --git|@@ -\d|--- |\+\+\+ )/m.test(text) && /^[+-][^+-]/m.test(text);
}

/** "tests/auth" and "sign-in.spec.ts" of a path. */
function splitPath(path: string) {
  const index = path.lastIndexOf('/');
  return index < 0
    ? { name: path, folder: '' }
    : { name: path.slice(index + 1), folder: path.slice(0, index) };
}

/** The hunk line as the pane shows it: "@@ new file · 13 lines" for a new file. */
function hunkLabel(text: string, added: number) {
  return /^@@ -0(?:,0)? \+/.test(text)
    ? `@@ new file · ${added} lines`
    : text.replace(/ @@.*$/, ' @@');
}

/**
 * The Changes tab of the tool pane (CH-B2): the changed files as 28px rows (the name in the UI
 * font, the folder muted after it, the counts on the right), then the diff of the selected
 * file. Long lines wrap with a hanging indent. A click on a line opens the file at that line in
 * the Code tab.
 */
export function DiffReview({
  diff,
  focusPath,
  focusRequest = 0,
  onOpenLine,
}: {
  diff: RepositoryDiff;
  /** A file to show first. It can be an absolute path or a path in the repository. */
  focusPath?: string;
  /** Increase this number to show `focusPath` again. */
  focusRequest?: number;
  /** Opens a file of the repository at a line, in the Code tab. */
  onOpenLine?: (path: string, line?: number) => void;
}) {
  const [selection, setSelection] = useState('');
  // Staged and unstaged changes show together. A file with both shows its two parts.
  const changed = [diff.staged, diff.unstaged]
    .flatMap((patch) => (patch.trim() ? diffFiles(patch) : []))
    .map((file, index) => ({ ...file, key: `tracked:${index}:${file.path}`, note: '' }));
  const files = [
    ...changed,
    ...diff.untracked.map((path) => {
      const preview = diff.newFiles?.find((file) => file.path === path);
      const text = preview?.text;
      const added = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
      return {
        key: `new:${path}`,
        path,
        added,
        removed: 0,
        patch:
          text !== undefined
            ? `@@ -0,0 +1,${added} @@\n` +
              text
                .replace(/\n$/, '')
                .split('\n')
                .map((line) => '+' + line)
                .join('\n')
            : '',
        note:
          preview?.reason ||
          (text === undefined
            ? 'Content is unavailable. Refresh with the updated desktop app.'
            : preview?.truncated
              ? 'New file preview truncated.'
              : ''),
      };
    }),
  ];
  // Show the requested file once for each request, when the diff has it.
  const focused = useRef(0);
  const focusKey = focusPath
    ? files.find(
        (file) =>
          file.path === focusPath ||
          focusPath.endsWith('/' + file.path) ||
          file.path.endsWith('/' + focusPath),
      )?.key
    : undefined;
  useEffect(() => {
    if (!focusKey || focused.current === focusRequest) return;
    focused.current = focusRequest;
    setSelection(focusKey);
  }, [focusKey, focusRequest]);
  const index = Math.max(
    0,
    files.findIndex((file) => file.key === selection),
  );
  const current = files[index];
  if (!current) return <EmptyState compact icon={<FileCheck />} title="No changes" />;
  const lines = current.patch
    ? numberLines(current.patch).filter((line) => line.kind !== 'header')
    : [];
  const firstChange = lines.find((line) => line.kind === 'add')?.newNumber;
  return (
    <section aria-label="File change review" className="diff-review">
      <ul className="diff-file-list" aria-label="Changed files">
        {files.map((file) => {
          const { name, folder } = splitPath(file.path);
          return (
            <li key={file.key}>
              <button
                type="button"
                className="diff-file"
                aria-current={file.key === current.key ? 'true' : undefined}
                title={file.path}
                onClick={() => setSelection(file.key)}
              >
                <File className="diff-file-icon" aria-hidden="true" />
                <span className="diff-file-name">{name}</span>
                {folder && <span className="diff-file-folder">{folder}</span>}
                <span className="diff-file-counts">
                  {!!file.added && <span className="diff-count-add">+{file.added}</span>}
                  {!!file.removed && <span className="diff-count-remove">−{file.removed}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {current.note && <p className="diff-review-note">{current.note}</p>}
      <div
        key={current.key}
        role="region"
        tabIndex={0}
        aria-label={`Changes: ${current.path}`}
        aria-description={onOpenLine ? 'Press Enter to open the file in Code.' : undefined}
        className="diff-view"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !onOpenLine || event.target !== event.currentTarget) return;
          event.preventDefault();
          onOpenLine(current.path, firstChange);
        }}
      >
        {lines.length ? (
          lines.map((line, row) => {
            if (line.kind === 'hunk')
              return (
                <div key={row} className="diff-view-hunk">
                  {hunkLabel(line.text, current.added)}
                </div>
              );
            const marked = line.kind === 'add' || line.kind === 'remove';
            const target = line.newNumber;
            return (
              <div
                key={row}
                className="diff-view-line"
                data-kind={line.kind}
                onClick={onOpenLine && target ? () => onOpenLine(current.path, target) : undefined}
              >
                <span className="diff-view-number" aria-hidden="true">
                  {line.newNumber ?? line.oldNumber ?? ''}
                </span>
                {signs[line.kind] && <span className="sr-only">{signs[line.kind]}</span>}
                <span className="diff-view-text">
                  {marked || line.kind === 'context' ? line.text.slice(1) : line.text}
                </span>
              </div>
            );
          })
        ) : (
          <p className="diff-review-note">No text preview available.</p>
        )}
      </div>
    </section>
  );
}
