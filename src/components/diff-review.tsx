import { useEffect, useRef, useState, type ReactElement } from 'react';
import { FileCheck, Paperclip } from 'lucide-react';
import type { RepositoryDiff } from '../types';
import { diffFiles } from '../lib/diff-files';
import { pathBasename } from '../lib/platform';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { Hint } from './hint';
import { cn } from '../lib/utils';

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

/**
 * One diff block for steps, approvals and the Changes pane: line numbers, and green and red
 * lines. `framed` draws the 10px frame of a code block. The Changes pane fills its edges.
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
        ? numberLines(patch).map((line, index) => (
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
  );
}

/** True when a step output or an approval detail is a patch. */
export function isPatch(text: string) {
  return /^(diff --git|@@ -\d|--- |\+\+\+ )/m.test(text) && /^[+-][^+-]/m.test(text);
}

export function DiffReview({
  diff,
  onAttach,
  disabled,
  disabledReason = '',
  focusPath,
  focusRequest = 0,
}: {
  diff: RepositoryDiff;
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
  // Staged and unstaged changes show together. A file with both shows its two parts.
  const changed = [diff.staged, diff.unstaged]
    .flatMap((patch) => (patch.trim() ? diffFiles(patch) : []))
    .map((file, index) => ({ ...file, key: `tracked:${index}:${file.path}`, note: '' }));
  const files = [
    ...changed,
    ...diff.untracked.map((path) => {
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
  return (
    <section aria-label="File change review" className="diff-review">
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
      {current.note && <p className="shrink-0 text-xs text-muted-foreground">{current.note}</p>}
      <DiffBlock key={current.key} patch={current.patch} framed={false} />
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
