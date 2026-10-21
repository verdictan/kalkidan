import { useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { API, FolderScan } from '../types';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { cn } from '../lib/utils';
import { showToast } from './ui/toast';

/** The one checkbox style in dialogs. There is no Checkbox primitive. */
export const checkboxClass =
  'size-4 shrink-0 cursor-pointer rounded-sm accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50';

/** The last part of a path, for a project name from a folder. */
export function folderName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/** "1 code folder" or "3 code folders". */
export function codeFolders(count: number) {
  return `${count} code folder${count === 1 ? '' : 's'}`;
}

/**
 * Tells the user how many code folders a new project got. `added` is the count in the snapshot,
 * not the count that the user selected.
 */
export function showFolderImportResult(name: string, added: number) {
  if (added > 0) showToast(`Created ${name} with ${codeFolders(added)}.`);
  else
    showToast({
      message: 'Kalkidan could not add the code folders. Select Add code folder to try again.',
      tone: 'error',
    });
}

/**
 * Shows the Git repositories that a folder scan found. All new repositories are selected.
 * Repositories that are already in Kalkidan show as "Already added" and cannot be selected.
 */
export function RepositoryImportDialog({
  open,
  onOpenChange,
  scan,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scan: FolderScan | null;
  /** Receives the selected paths. With no repository found, it receives the folder itself. */
  onImported: (paths: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const repositories = scan?.repositories || [];
  const available = repositories.filter((repo) => !repo.added);
  useEffect(() => {
    if (open) setSelected(new Set(available.map((repo) => repo.path)));
    // Select again only when a new scan opens.
  }, [open, scan]);
  const folder = scan ? folderName(scan.root) : '';
  const count = selected.size;
  function toggle(path: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>
            {repositories.length
              ? `Found ${repositories.length} Git ${repositories.length === 1 ? 'repository' : 'repositories'} in ${folder}`
              : `No Git repositories found in ${folder}`}
          </DialogTitle>
          <DialogDescription title={scan?.root}>
            {repositories.length
              ? 'Each repository becomes a code folder in the project. Clear the ones you do not want.'
              : 'Kalkidan looked in this folder and its subfolders. You can add the folder anyway.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid content-start gap-2">
          {repositories.length > 0 && (
            <>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!available.length || count === available.length}
                  onClick={() => setSelected(new Set(available.map((repo) => repo.path)))}
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!count}
                  onClick={() => setSelected(new Set())}
                >
                  Select none
                </Button>
                <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
                  {count} of {available.length} selected
                </span>
              </div>
              <ul className="list-box max-h-none" aria-label="Git repositories found">
                {repositories.map((repo) => (
                  <li key={repo.path} className="min-w-0">
                    <label
                      title={repo.path}
                      className={cn(
                        'list-box-row row-focus min-h-[var(--row-height-lg)] gap-3 py-1.5',
                        repo.added
                          ? 'opacity-50'
                          : 'cursor-pointer hover:bg-[var(--surface-hover)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        className={cn(checkboxClass, 'focus-visible:outline-none')}
                        disabled={repo.added}
                        checked={repo.added || selected.has(repo.path)}
                        onChange={(event) => toggle(repo.path, event.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{repo.name}</span>
                        {relativePath(scan?.root ?? '', repo.path) !== repo.name && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {relativePath(scan?.root ?? '', repo.path)}
                          </span>
                        )}
                      </span>
                      {repo.added ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          Already added
                        </span>
                      ) : (
                        repo.branch && (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            <GitBranch className="size-3.5" aria-hidden="true" />
                            {repo.branch}
                          </span>
                        )
                      )}
                    </label>
                  </li>
                ))}
              </ul>
              {!available.length && (
                <p className="form-help mt-0">All these repositories are already in Kalkidan.</p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {repositories.length ? (
            <Button disabled={!count} onClick={() => onImported([...selected])}>
              Add {codeFolders(count)}
            </Button>
          ) : (
            <Button disabled={!scan} onClick={() => scan && onImported([scan.root])}>
              Add this folder anyway
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface FolderImport {
  /** The scanned folder. */
  root: string;
  /** The folders to add as code folders. */
  paths: string[];
}

/**
 * Chooses a folder, finds the Git repositories in it, and asks which ones to add.
 * Render `dialog` once. `choose` resolves null when the user cancels.
 */
export function useFolderImport(api: API, scope: string = 'default') {
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: FolderImport | null) => void) | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  // Older desktop builds and the browser preview cannot open the native folder dialog.
  const supported = typeof api.chooseFolder === 'function';
  function settle(value: FolderImport | null) {
    generation.current++;
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }
  useEffect(() => {
    mounted.current = true;
    setOpen(false);
    return () => {
      mounted.current = false;
      generation.current++;
      resolver.current?.(null);
      resolver.current = null;
    };
  }, [api, scope]);
  /** Scans a folder that the user already chose, for example on a remote host. */
  async function scanFolder(path: string, hostId?: string): Promise<FolderImport | null> {
    if (!mounted.current) return null;
    const request = ++generation.current;
    resolver.current?.(null);
    resolver.current = null;
    setOpen(false);
    if (typeof api.scanRepositories !== 'function') return { root: path, paths: [path] };
    const result = await api.scanRepositories(path, hostId);
    if (!mounted.current || request !== generation.current) return null;
    const [only] = result.repositories;
    if (result.repositories.length === 1 && result.rootIsRepository && !only.added)
      return { root: result.root, paths: [result.root] };
    setScan(result);
    setOpen(true);
    return new Promise((resolve) => {
      resolver.current = (value) => resolve(value && { root: result.root, paths: value.paths });
    });
  }
  /** Opens the native folder dialog, then scans the folder. */
  async function choose(title = 'Choose a code folder', buttonLabel = 'Choose') {
    const request = ++generation.current;
    resolver.current?.(null);
    resolver.current = null;
    setOpen(false);
    const path = await api.chooseFolder(title, buttonLabel);
    if (!path || !mounted.current || request !== generation.current) return null;
    return scanFolder(path);
  }
  const dialog = (
    <RepositoryImportDialog
      open={open}
      scan={scan}
      onOpenChange={(next) => !next && settle(null)}
      onImported={(paths) => settle({ root: scan?.root || '', paths })}
    />
  );
  return { supported, choose, scanFolder, cancel: () => settle(null), dialog };
}

/** Shows a found repository relative to the chosen folder, for example "tools/cli". */
function relativePath(root: string, path: string) {
  const base = root.replace(/[\\/]+$/, '');
  if (path === base) return 'The chosen folder';
  return path.startsWith(base) ? path.slice(base.length).replace(/^[\\/]+/, '') : path;
}
