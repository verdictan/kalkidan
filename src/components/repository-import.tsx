import { useEffect, useRef, useState, type Ref } from 'react';
import { GitBranch } from 'lucide-react';
import type { API, FolderScan } from '../types';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
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

/** The selected repositories of a scan. All new repositories start selected. */
function useRepositorySelection(scan: FolderScan | null, open: boolean) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const repositories = scan?.repositories || [];
  const available = repositories.filter((repo) => !repo.added);
  // Select all new repositories when a new scan opens. Do it during render, so that the main
  // button is enabled when the dialog moves focus to it.
  const [selectedScan, setSelectedScan] = useState<FolderScan | null>(null);
  if (open && scan !== selectedScan) {
    setSelectedScan(scan);
    setSelected(new Set(available.map((repo) => repo.path)));
  }
  if (!open && selectedScan) setSelectedScan(null);
  function toggle(path: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }
  return { selected, setSelected, toggle, repositories, available };
}

/** The title of a scan result, for example "Found 3 Git repositories in work". */
function scanTitle(scan: FolderScan | null) {
  const count = scan?.repositories.length ?? 0;
  const folder = scan ? folderName(scan.root) : '';
  return count
    ? `Found ${count} Git ${count === 1 ? 'repository' : 'repositories'} in ${folder}`
    : `No Git repositories found in ${folder}`;
}

function scanDescription(scan: FolderScan | null) {
  return scan?.repositories.length
    ? 'Each repository becomes a code folder in the project.'
    : 'Kalkidan looked in this folder and its subfolders. You can add the folder anyway.';
}

/** The check box list of found repositories, with one Select all / Select none toggle. */
function RepositoryChecklist({
  scan,
  selection,
  className,
}: {
  scan: FolderScan | null;
  selection: ReturnType<typeof useRepositorySelection>;
  className?: string;
}) {
  const { selected, setSelected, toggle, repositories, available } = selection;
  const count = selected.size;
  const all = available.length > 0 && count === available.length;
  if (!repositories.length) return null;
  return (
    <div className={cn('grid content-start gap-2', className)}>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="-ml-2"
          disabled={!available.length}
          onClick={() => setSelected(all ? new Set() : new Set(available.map((repo) => repo.path)))}
        >
          {all ? 'Select none' : 'Select all'}
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
                repo.added ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--surface-hover)]',
              )}
            >
              <Checkbox
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
                <span className="shrink-0 text-xs text-muted-foreground">Already added</span>
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
    </div>
  );
}

/** The Cancel and Add buttons of a scan result. */
function RepositoryImportActions({
  scan,
  selection,
  primary,
  size,
  onCancel,
  onImported,
}: {
  scan: FolderScan | null;
  selection: ReturnType<typeof useRepositorySelection>;
  primary?: Ref<HTMLButtonElement>;
  size?: 'sm' | 'default';
  onCancel: () => void;
  onImported: (paths: string[]) => void;
}) {
  const count = selection.selected.size;
  return (
    <>
      <Button variant="outline" size={size} onClick={onCancel}>
        Cancel
      </Button>
      {selection.repositories.length ? (
        <Button
          ref={primary}
          size={size}
          disabled={!count}
          onClick={() => onImported([...selection.selected])}
        >
          Add {codeFolders(count)}
        </Button>
      ) : (
        <Button
          ref={primary}
          size={size}
          disabled={!scan}
          onClick={() => scan && onImported([scan.root])}
        >
          Add this folder anyway
        </Button>
      )}
    </>
  );
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
  const primary = useRef<HTMLButtonElement>(null);
  const selection = useRepositorySelection(scan, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        layout="scroll"
        onOpenAutoFocus={(event) => {
          // Start on the main action. The user can add the selected folders at once.
          if (!primary.current || primary.current.disabled) return;
          event.preventDefault();
          primary.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{scanTitle(scan)}</DialogTitle>
          <DialogDescription title={scan?.root}>{scanDescription(scan)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid content-start gap-2">
          <RepositoryChecklist scan={scan} selection={selection} />
        </DialogBody>
        <DialogFooter>
          <RepositoryImportActions
            scan={scan}
            selection={selection}
            primary={primary}
            onCancel={() => onOpenChange(false)}
            onImported={onImported}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same choice as RepositoryImportDialog, inside another surface, for example the first
 * onboarding step. It does not replace the surface that holds it.
 */
export function RepositoryImportPanel({
  scan,
  onCancel,
  onImported,
}: {
  scan: FolderScan | null;
  onCancel: () => void;
  onImported: (paths: string[]) => void;
}) {
  const selection = useRepositorySelection(scan, !!scan);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (primary.current && !primary.current.disabled) primary.current.focus();
  }, [scan]);
  return (
    <section className="onboarding-import" aria-label={scanTitle(scan)} title={scan?.root}>
      <div className="grid gap-0.5">
        <h4 className="text-sm font-medium">{scanTitle(scan)}</h4>
        <p className="text-xs leading-4 text-muted-foreground">{scanDescription(scan)}</p>
      </div>
      <RepositoryChecklist scan={scan} selection={selection} className="max-h-56 overflow-y-auto" />
      <div className="flex justify-end gap-2">
        <RepositoryImportActions
          scan={scan}
          selection={selection}
          primary={primary}
          size="sm"
          onCancel={onCancel}
          onImported={onImported}
        />
      </div>
    </section>
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
 * Render `dialog` once, or `panel` with `{ inline: true }`. `choose` resolves null when the user cancels.
 */
export function useFolderImport(
  api: API,
  scope: string = 'default',
  options: { inline?: boolean } = {},
) {
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
  // Inline: the caller renders `panel` in its own surface, and `dialog` is empty.
  const dialog = options.inline ? null : (
    <RepositoryImportDialog
      open={open}
      scan={scan}
      onOpenChange={(next) => !next && settle(null)}
      onImported={(paths) => settle({ root: scan?.root || '', paths })}
    />
  );
  const panel =
    options.inline && open ? (
      <RepositoryImportPanel
        scan={scan}
        onCancel={() => settle(null)}
        onImported={(paths) => settle({ root: scan?.root || '', paths })}
      />
    ) : null;
  return { supported, choose, scanFolder, cancel: () => settle(null), dialog, panel, open };
}

/** Shows a found repository relative to the chosen folder, for example "tools/cli". */
function relativePath(root: string, path: string) {
  const base = root.replace(/[\\/]+$/, '');
  if (path === base) return 'The chosen folder';
  return path.startsWith(base) ? path.slice(base.length).replace(/^[\\/]+/, '') : path;
}
