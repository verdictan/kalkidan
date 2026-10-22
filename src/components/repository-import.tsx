import { useEffect, useRef } from 'react';
import { GitBranch } from 'lucide-react';
import type { API, FolderScan } from '../types';
import { Checkbox } from './ui/checkbox';
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
 * Tells the user when a new project got no code folders. A project that got its folders needs
 * no message: the sidebar shows it. `added` is the count in the snapshot, not the count that
 * the user selected.
 */
export function showFolderImportResult(_name: string, added: number) {
  if (added > 0) return;
  showToast({
    message: 'Kalkidan could not add the code folders. Select Add code folder… to try again.',
    tone: 'error',
  });
}

/** Shows a found repository relative to the chosen folder, for example "tools/cli". */
export function relativePath(root: string, path: string) {
  const base = root.replace(/[\\/]+$/, '');
  if (path === base) return '';
  return path.startsWith(base) ? path.slice(base.length).replace(/^[\\/]+/, '') : path;
}

/**
 * The found Git repositories of a scan, each with a check box. All new repositories start
 * checked. Repositories that are already in Kalkidan are left out. The Welcome card shows it.
 */
export function RepositoryChecklist({
  scan,
  selected,
  onChange,
  disabled,
  className,
}: {
  scan: FolderScan;
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  disabled?: boolean;
  className?: string;
}) {
  const repositories = scan.repositories.filter((repo) => !repo.added);
  if (!repositories.length) return null;
  return (
    <ul className={cn('repository-checklist', className)} aria-label="Git repositories">
      {repositories.map((repo) => {
        const relative = relativePath(scan.root, repo.path);
        return (
          <li key={repo.path}>
            <label title={repo.path} className="repository-checklist-row row-focus">
              <Checkbox
                checked={selected.has(repo.path)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(repo.path);
                  else next.delete(repo.path);
                  onChange(next);
                }}
              />
              <span className="repository-checklist-name">{repo.name}</span>
              {relative && relative !== repo.name && (
                <span className="repository-checklist-path">{relative}</span>
              )}
              {repo.branch && (
                <span className="repository-checklist-branch">
                  <GitBranch aria-hidden="true" />
                  {repo.branch}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** The paths to add from a scan: every new repository, or the folder itself when it has none. */
export function importPaths(scan: FolderScan) {
  const available = scan.repositories.filter((repo) => !repo.added).map((repo) => repo.path);
  if (available.length) return available;
  return scan.repositories.length ? [] : [scan.root];
}

export interface FolderImport {
  /** The scanned folder. */
  root: string;
  /** The folders to add as code folders. */
  paths: string[];
}

/**
 * Chooses a folder, finds the Git repositories in it, and adds all of them: there is no
 * question. The user unchecks a code folder later in Settings › the project. A folder without
 * a repository is added as it is. `choose` resolves null when the user cancels, or when every
 * repository in the folder is already in Kalkidan. `dialog` and `panel` are always empty now.
 */
export function useFolderImport(
  api: API,
  scope: string = 'default',
  _options: { inline?: boolean } = {},
) {
  const generation = useRef(0);
  const mounted = useRef(true);
  // Older desktop builds and the browser preview cannot open the native folder dialog.
  const supported = typeof api.chooseFolder === 'function';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [api, scope]);
  /** Scans a folder that the user already chose, for example on a remote host. */
  async function scanFolder(path: string, hostId?: string): Promise<FolderImport | null> {
    if (!mounted.current) return null;
    const request = ++generation.current;
    if (typeof api.scanRepositories !== 'function') return { root: path, paths: [path] };
    const result = await api.scanRepositories(path, hostId);
    if (!mounted.current || request !== generation.current) return null;
    const paths = importPaths(result);
    if (!paths.length) {
      showToast(`Every Git repository in ${folderName(result.root)} is already in Kalkidan.`);
      return null;
    }
    return { root: result.root, paths };
  }
  /** Opens the native folder dialog, then scans the folder. */
  async function choose(title = 'Choose a code folder', buttonLabel = 'Choose') {
    const request = ++generation.current;
    const path = await api.chooseFolder(title, buttonLabel);
    if (!path || !mounted.current || request !== generation.current) return null;
    return scanFolder(path);
  }
  return {
    supported,
    choose,
    scanFolder,
    cancel: () => {
      generation.current++;
    },
    dialog: null,
    panel: null,
    open: false,
  };
}
