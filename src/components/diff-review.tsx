import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { RepositoryDiff } from '../types';
import { diffFiles } from '../lib/diff-files';
import { Button } from './ui/button';
import { Choice } from './choice';

export function DiffReview({
  diff,
  scope,
  onAttach,
  disabled,
}: {
  diff: RepositoryDiff;
  scope: string;
  onAttach: (label: string, text: string) => void;
  disabled: boolean;
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
  const index = Math.max(
    0,
    files.findIndex((file) => file.key === selection),
  );
  const current = files[index];
  if (!current)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No changes in this scope.</p>
    );
  return (
    <section aria-label="File change review" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
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
      <Choice
        className="w-full min-w-0"
        label="Changed file"
        value={current.key}
        onChange={setSelection}
        options={files.map((file) => ({
          value: file.key,
          label: `${file.path} · +${file.added} −${file.removed}`,
        }))}
      />
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="min-w-0 flex-1 break-all font-mono">{current.path}</span>
        <span className="text-emerald-400">+{current.added}</span>
        <span className="text-red-400">−{current.removed}</span>
      </div>
      {current.note && <p className="text-xs text-muted-foreground">{current.note}</p>}
      <pre key={current.key} aria-label="Git diff" className="tool-output diff-output max-h-[55vh]">
        {current.patch
          ? current.patch.split('\n').map((line, index) => (
              <span
                key={index}
                className={
                  line.startsWith('+')
                    ? 'diff-addition'
                    : line.startsWith('-')
                      ? 'diff-deletion'
                      : line.startsWith('@@')
                        ? 'diff-location'
                        : ''
                }
              >
                {line}
                {'\n'}
              </span>
            ))
          : 'No text preview available.'}
      </pre>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !current.patch}
        onClick={() => onAttach(current.path, current.patch)}
      >
        Attach this file’s changes
      </Button>
    </section>
  );
}
