import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import type { RepositoryDiff } from '../types';
import { diffFiles } from '../lib/diff-files';
import { pathBasename, plural } from '../lib/platform';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { Hint } from './hint';

/** The folder part of a path, without the file name. Empty for a file at the root. */
function folderOf(path: string) {
  const name = pathBasename(path);
  return path.length > name.length ? path.slice(0, -name.length).replace(/[\\/]+$/, '') : '';
}

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
const lineClass: Record<DiffLineKind, string> = {
  header: 'diff-line diff-header',
  hunk: 'diff-line diff-location',
  add: 'diff-line diff-addition',
  remove: 'diff-line diff-deletion',
  context: 'diff-line',
};

export function DiffReview({
  diff,
  scope,
  onAttach,
  disabled,
  disabledReason = '',
  focusPath,
  focusRequest = 0,
}: {
  diff: RepositoryDiff;
  scope: string;
  onAttach: (label: string, text: string) => void;
  disabled: boolean;
  /** Why the attach button is disabled. */
  disabledReason?: string;
  /** A file to show first. It can be an absolute path or a path in the repository. */
  focusPath?: string;
  /** Increase this number to show `focusPath` again. */
  focusRequest?: number;
}) {
  const [selection, setSelection] = useState('');
  const changed = diffFiles(scope === 'staged' ? diff.staged : diff.unstaged).map(
    (file, index) => ({ ...file, key: `tracked:${index}:${file.path}`, note: '' }),
  );
  const files = [
    ...changed,
    ...(scope === 'unstaged'
      ? diff.untracked.map((path) => {
          const preview = diff.newFiles?.find((file) => file.path === path);
          const text = preview?.text;
          return {
            key: `new:${path}`,
            path,
            added: text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0,
            removed: 0,
            patch:
              text !== undefined
                ? text
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
                  : 'New, untracked file'),
          };
        })
      : []),
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
  if (!current) return <EmptyState compact title="No changes in this scope" />;
  return (
    <section aria-label="File change review" className="diff-review">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {plural(files.length, 'changed file')}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous changed file"
          disabled={index === 0}
          onClick={() => setSelection(files[index - 1].key)}
        >
          <ChevronLeft />
        </Button>
        <span className="text-xs tabular-nums">
          {index + 1} / {files.length}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next changed file"
          disabled={index === files.length - 1}
          onClick={() => setSelection(files[index + 1].key)}
        >
          <ChevronRight />
        </Button>
      </div>
      <ul className="diff-file-list" aria-label="Changed files">
        {files.map((file) => (
          <li key={file.key}>
            <button
              type="button"
              className="diff-file"
              aria-current={file.key === current.key ? 'true' : undefined}
              title={file.path}
              onClick={() => setSelection(file.key)}
            >
              <span className="diff-file-name">{pathBasename(file.path)}</span>
              {folderOf(file.path) && <span className="diff-file-path">{folderOf(file.path)}</span>}
              <span className="diff-count-add">+{file.added}</span>
              <span className="diff-count-remove">−{file.removed}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 flex-wrap gap-2 text-xs">
        <span className="min-w-0 flex-1 font-mono break-all">{current.path}</span>
        <span className="text-diff-add">+{current.added}</span>
        <span className="text-diff-remove">−{current.removed}</span>
      </div>
      {current.note && <p className="shrink-0 text-xs text-muted-foreground">{current.note}</p>}
      <pre
        key={current.key}
        role="region"
        tabIndex={0}
        aria-label="Git diff"
        className="tool-output diff-output"
      >
        {current.patch
          ? numberLines(current.patch).map((line, index) => (
              <span key={index} className={lineClass[line.kind]}>
                <span className="diff-gutter" aria-hidden="true">
                  {line.oldNumber ?? ''}
                </span>
                <span className="diff-gutter" aria-hidden="true">
                  {line.newNumber ?? ''}
                </span>
                <span className="diff-text">{line.text}</span>
                {'\n'}
              </span>
            ))
          : 'No text preview available.'}
      </pre>
      <AttachHint reason={current.patch ? disabledReason : ''}>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 self-start"
          disabled={disabled || !current.patch}
          onClick={() => onAttach(current.path, current.patch)}
        >
          <Paperclip aria-hidden="true" />
          Attach file to message
        </Button>
      </AttachHint>
    </section>
  );
}
