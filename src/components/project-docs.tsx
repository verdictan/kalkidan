import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { WikiEditor } from './wiki-editor';
import { ActionMenu } from './action-menu';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { API, ProjectGroup } from '../types';
import type { DeletedProjectDoc, ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import { hasPrimaryModifier } from '../lib/platform';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { showToast } from './ui/toast';
import { Choice } from './choice';
import { Hint } from './hint';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { MoreButton } from './ui/more-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { errorMessage } from '../lib/errors';

type TreeCommand = {
  id: string;
  kind: 'move' | 'rename' | 'delete' | 'order';
  /** The new sibling position for kind 'order'. */
  order?: number;
  serial: number;
};

/** Sorts sibling pages by their order, then by title. Pages without an order come last. */
export function compareDocs(
  a: ProjectDocMetadata,
  b: ProjectDocMetadata,
  titleOf: (page: ProjectDocMetadata) => string = (page) => page.title,
) {
  const left = a.order ?? Number.POSITIVE_INFINITY;
  const right = b.order ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left < right ? -1 : 1;
  return titleOf(a).localeCompare(titleOf(b));
}

export function sortedSiblings(pages: ProjectDocMetadata[], parentId: string | null) {
  return pages.filter((p) => p.parentId === parentId).sort((a, b) => compareDocs(a, b));
}

/** Returns all pages in tree order with their depth. A page in a parent loop is not included. */
export function docTreeOrder(pages: ProjectDocMetadata[]) {
  const result: { page: ProjectDocMetadata; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number, seen: Set<string>) => {
    for (const page of sortedSiblings(pages, parentId)) {
      if (seen.has(page.id)) continue;
      result.push({ page, depth });
      visit(page.id, depth + 1, new Set(seen).add(page.id));
    }
  };
  visit(null, 0, new Set());
  return result;
}

/**
 * Chooses the page to show after a delete: the parent, then the previous
 * sibling in tree order, then the first remaining page.
 */
export function pageAfterDelete(pages: ProjectDocMetadata[], deletedId: string) {
  const deleted = pages.find((p) => p.id === deletedId);
  const remaining = pages.filter((p) => p.id !== deletedId);
  if (deleted?.parentId && remaining.some((p) => p.id === deleted.parentId))
    return deleted.parentId;
  if (deleted) {
    const siblings = sortedSiblings(pages, deleted.parentId);
    const previous = siblings[siblings.findIndex((p) => p.id === deletedId) - 1];
    if (previous) return previous.id;
  }
  return sortedSiblings(remaining, null)[0]?.id || remaining[0]?.id || '';
}

/** Alerts in the editor: under the document bar, at the width of the text column. */
const docAlertClass = 'mx-auto mt-3 w-[min(var(--reading-width),calc(100%-3rem))]';

const selectionKey = (groupId: string) => 'kalkidan-docs-selected:' + groupId;
const libraryWidthKey = 'kalkidan-docs-library-width';
const libraryWidth = { min: 200, max: 360, initial: 240 };

function readLibraryWidth() {
  try {
    const value = Number(localStorage.getItem(libraryWidthKey));
    return value >= libraryWidth.min && value <= libraryWidth.max ? value : libraryWidth.initial;
  } catch {
    return libraryWidth.initial;
  }
}

/** The drag handle on the right edge of the page list. Arrow keys also change the width. */
function LibraryResizer({ width, onResize }: { width: number; onResize: (value: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const stop = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      className="docs-library-resizer"
      data-dragging={dragging || undefined}
      role="separator"
      aria-label="Resize page list"
      aria-orientation="vertical"
      aria-valuemin={libraryWidth.min}
      aria-valuemax={libraryWidth.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize the page list. Double-click to reset."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(drag.current.width + e.clientX - drag.current.x);
      }}
      onPointerUp={(e) => {
        stop();
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => onResize(libraryWidth.initial)}
      onKeyDown={(e) => {
        const value =
          e.key === 'ArrowLeft'
            ? width - 10
            : e.key === 'ArrowRight'
              ? width + 10
              : e.key === 'Home'
                ? libraryWidth.min
                : e.key === 'End'
                  ? libraryWidth.max
                  : null;
        if (value !== null) {
          e.preventDefault();
          onResize(value);
        }
      }}
    />
  );
}

/** Returns the stored page when it still exists, else the first page. */
export function initialPage(pages: ProjectDocMetadata[], stored: string | null) {
  if (stored && pages.some((p) => p.id === stored)) return stored;
  return pages[0]?.id || '';
}

function readSelection(groupId: string) {
  try {
    return localStorage.getItem(selectionKey(groupId));
  } catch {
    return null;
  }
}

function writeSelection(groupId: string, id: string) {
  try {
    localStorage.setItem(selectionKey(groupId), id);
  } catch {
    // Storage can be unavailable. The selection then resets on the next visit.
  }
}

function DocEditor({
  api,
  groupId,
  initial,
  onSaved,
  onDelete,
  pages,
  onSubpage,
  onNavigate,
  onReorder,
  onTitleEditing,
  treeCommand,
  onTreeCommandHandled,
}: {
  onTreeCommandHandled: () => void;
  treeCommand?: TreeCommand;
  onSubpage: () => void;
  /** Moves the page one place up (-1) or down (1). Undefined when it cannot move that way. */
  onReorder: { up?: () => void; down?: () => void };
  /** Called when the title field gets or loses focus. The page list does not sort meanwhile. */
  onTitleEditing: (editing: boolean) => void;
  onNavigate: (id: string) => void;
  pages: ProjectDocMetadata[];
  api: API;
  groupId: string;
  initial: ProjectDoc;
  onSaved: (doc: ProjectDoc) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [mode, setMode] = useState('write');
  const [moving, setMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState('root');
  const titleInput = useRef<HTMLInputElement>(null);
  function rename() {
    setMode('write');
    requestAnimationFrame(() => {
      titleInput.current?.focus();
      titleInput.current?.select();
    });
  }
  function startMove() {
    setMoveTarget(latest.current.parentId || 'root');
    setMoving(true);
  }
  function requestDelete() {
    void flush().then(() => {
      if (!failed.current) onDelete();
    });
  }
  useEffect(() => {
    if (treeCommand?.id !== initial.id) return;
    if (treeCommand.kind === 'move') startMove();
    else if (treeCommand.kind === 'delete') requestDelete();
    else if (treeCommand.kind === 'order') {
      update({ ...latest.current, order: treeCommand.order });
      void flush();
    } else rename();
    onTreeCommandHandled();
  }, [treeCommand, initial.id]);
  const [editorVersion, setEditorVersion] = useState(0);
  const [status, setStatus] = useState('Saved');
  const revision = useRef(initial.revision);
  const latest = useRef(initial);
  const pending = useRef<ProjectDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  // A failed save stops later saves until the next edit or a retry.
  const failed = useRef(false);
  const [error, setError] = useState('');
  const recoveryKey = 'kalkidan-doc-draft:' + groupId + ':' + initial.id;
  const [recovery, setRecovery] = useState<ProjectDoc | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(recoveryKey) || 'null');
    } catch {
      return null;
    }
  });
  function storeDraft(value: ProjectDoc | null) {
    try {
      if (value) localStorage.setItem(recoveryKey, JSON.stringify(value));
      else localStorage.removeItem(recoveryKey);
    } catch {
      // Storage can be unavailable. Autosave still runs.
    }
  }
  function flush() {
    clearTimeout(timer.current);
    const value = pending.current;
    if (!value || failed.current) return queue.current;
    pending.current = null;
    queue.current = queue.current.then(async () => {
      if (failed.current) {
        pending.current ??= value;
        return;
      }
      try {
        // A page with an empty title is saved as "Untitled".
        const saved = await api.docsSave(groupId, {
          ...value,
          title: value.title.trim() || 'Untitled',
          revision: revision.current,
        });
        revision.current = saved.revision;
        onSaved(saved);
        if (latest.current === value) {
          setStatus('Saved');
          setError('');
          storeDraft(null);
        }
      } catch (e) {
        failed.current = true;
        // Keep the newest draft so that a retry can save it.
        pending.current ??= latest.current;
        setError(errorMessage(e));
        setStatus('Not saved');
      }
    });
    return queue.current;
  }
  function retry() {
    failed.current = false;
    pending.current ??= latest.current;
    setStatus('Saving…');
    void flush();
  }
  function update(value: ProjectDoc) {
    latest.current = value;
    pending.current = value;
    failed.current = false;
    setDraft(value);
    setStatus('Saving…');
    storeDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }
  useEffect(() => {
    const unload = () => {
      void flush();
    };
    const saveKey = (event: KeyboardEvent) => {
      if (hasPrimaryModifier(event) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flush();
      }
    };
    window.addEventListener('keydown', saveKey);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('keydown', saveKey);
      window.removeEventListener('beforeunload', unload);
      void flush();
    };
  }, []);
  const parentTitle = draft.parentId && pages.find((p) => p.id === draft.parentId)?.title;
  return (
    <section className="doc-editor" aria-label="Document editor">
      <div className="wiki-document-bar">
        {/* The title bar shows the project and Docs. Here, show only the parent page and the page. */}
        <nav className="wiki-breadcrumbs" aria-label="Document breadcrumb">
          {draft.parentId && parentTitle && (
            <>
              <button title={parentTitle} onClick={() => onNavigate(draft.parentId!)}>
                {parentTitle}
              </button>
              <ChevronRight size={12} aria-hidden="true" />
            </>
          )}
          <span aria-current="page" title={draft.title || 'Untitled'}>
            {draft.title || 'Untitled'}
          </span>
        </nav>
        <div className="wiki-document-actions">
          {/* Do not announce each save. Announce only a failed save. */}
          <span role="status" aria-live="off">
            {status}
          </span>
          {status === 'Not saved' && (
            <span role="alert" className="sr-only">
              The page is not saved.
            </span>
          )}
          {status === 'Not saved' && (
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          )}
          <Hint label={mode === 'read' ? 'Back to editing' : 'Preview'}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Preview"
              aria-pressed={mode === 'read'}
              onClick={() => setMode(mode === 'read' ? 'write' : 'read')}
            >
              {mode === 'read' ? <Pencil size={16} /> : <Eye size={16} />}
            </Button>
          </Hint>
          <ActionMenu
            label="Document actions"
            items={[
              { label: 'Rename page', action: rename },
              { label: 'Move page', action: startMove },
              {
                label: 'Move up',
                disabled: !onReorder.up,
                action: () => onReorder.up?.(),
              },
              {
                label: 'Move down',
                disabled: !onReorder.down,
                action: () => onReorder.down?.(),
              },
              { label: 'Add subpage', action: onSubpage },
              {
                label: mode === 'source' ? 'Rich text editor' : 'Markdown source',
                action: () => setMode(mode === 'source' ? 'write' : 'source'),
              },
              { label: 'Delete page', danger: true, action: requestDelete },
            ]}
          />
        </div>
      </div>
      {recovery && (
        <Alert role={undefined} size="sm" className={docAlertClass}>
          <AlertDescription className="doc-alert-body">
            An unsaved draft is available.
            <span className="doc-alert-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  update({ ...recovery, revision: initial.revision });
                  setEditorVersion((v) => v + 1);
                  setRecovery(null);
                }}
              >
                Restore draft
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  storeDraft(null);
                  setRecovery(null);
                }}
              >
                Discard draft
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" size="sm" className={docAlertClass}>
          <AlertDescription>{error} Your draft is kept locally for recovery.</AlertDescription>
        </Alert>
      )}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move page</DialogTitle>
            <DialogDescription>Choose the parent page for this page.</DialogDescription>
          </DialogHeader>
          <Choice
            label="Parent page"
            value={moveTarget}
            onChange={setMoveTarget}
            options={[
              { value: 'root', label: 'Top-level page' },
              // The list shows the tree. Each level adds a dash before the title.
              ...docTreeOrder(pages)
                .filter(({ page: p }) => {
                  let cursor: ProjectDocMetadata | undefined = p;
                  const seen = new Set<string>();
                  while (cursor) {
                    if (cursor.id === draft.id || seen.has(cursor.id)) return false;
                    seen.add(cursor.id);
                    cursor = pages.find((x) => x.id === cursor?.parentId);
                  }
                  return true;
                })
                .map(({ page: p, depth }) => ({
                  value: p.id,
                  label: `${'— '.repeat(depth)}${p.title}`,
                })),
            ]}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              disabled={moveTarget === (draft.parentId || 'root')}
              onClick={() => {
                // The page goes to the end of its new parent's list.
                update({
                  ...latest.current,
                  parentId: moveTarget === 'root' ? null : moveTarget,
                  order: undefined,
                });
                void flush();
                setMoving(false);
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="wiki-page">
        <input
          ref={titleInput}
          className="doc-title"
          aria-label="Page title"
          placeholder="Untitled"
          value={draft.title}
          readOnly={mode === 'read'}
          onChange={(e) => update({ ...latest.current, title: e.target.value })}
          onFocus={() => onTitleEditing(true)}
          onBlur={() => {
            onTitleEditing(false);
            void flush();
          }}
        />
        {mode === 'source' ? (
          <textarea
            className="wiki-source font-mono"
            aria-label="Markdown content"
            value={draft.markdown}
            onChange={(e) => update({ ...latest.current, markdown: e.target.value })}
            onBlur={() => void flush()}
          />
        ) : (
          <WikiEditor
            key={editorVersion + ':' + (mode === 'source' ? 'source' : 'rich')}
            markdown={draft.markdown}
            readOnly={mode === 'read'}
            onChange={(markdown) => update({ ...latest.current, markdown })}
            groupId={groupId}
            onOpenPage={(id) => {
              if (pages.some((p) => p.id === id)) onNavigate(id);
              else showToast({ message: 'This page is not in these docs.', tone: 'error' });
            }}
          />
        )}
      </div>
    </section>
  );
}

export function ProjectDocsPanel({
  api,
  group,
  initialPageId,
}: {
  api: API;
  group: ProjectGroup;
  /** Opens this page, for example from a search result. */
  initialPageId?: string;
}) {
  const [pages, setPages] = useState<ProjectDocMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const [treeCommand, setTreeCommand] = useState<TreeCommand>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [title, setTitle] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletedPages, setDeletedPages] = useState<DeletedProjectDoc[] | null>(null);
  const [page, setPage] = useState<ProjectDoc | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  // While a title is edited, the list sorts by the titles from before the edit.
  const [frozenTitles, setFrozenTitles] = useState<Map<string, string> | null>(null);
  const [width, setWidth] = useState(readLibraryWidth);
  // Only Rename moves focus to the page title. Other menu items return focus to the menu.
  const focusTitle = useRef(false);
  function resizeLibrary(value: number) {
    const next = Math.round(Math.min(libraryWidth.max, Math.max(libraryWidth.min, value)));
    setWidth(next);
    try {
      localStorage.setItem(libraryWidthKey, String(next));
    } catch {
      // Storage can be unavailable. The width then resets on the next visit.
    }
  }
  useEffect(() => {
    let live = true;
    setPage(null);
    if (!selected) return;
    setPageLoading(true);
    api
      .docsRead(group.id, selected)
      .then((doc) => {
        if (live) {
          setPage(doc);
          setError('');
        }
      })
      .catch((error) => {
        if (live) setError(errorMessage(error));
      })
      .finally(() => {
        if (live) setPageLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, group.id, selected]);
  useEffect(() => {
    if (selected) writeSelection(group.id, selected);
    setFrozenTitles(null);
  }, [group.id, selected]);
  useEffect(() => {
    let live = true;
    api
      .docsMetadata(group.id)
      .then((value) => {
        if (live) {
          setPages(value);
          setSelected(initialPage(value, initialPageId || readSelection(group.id)));
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, group.id]);
  useEffect(() => {
    if (initialPageId && pages.some((p) => p.id === initialPageId)) setSelected(initialPageId);
  }, [initialPageId, pages.length > 0]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function saved(doc: ProjectDoc) {
    setPage((current) => (current?.id === doc.id ? doc : current));
    setPages((current) => current.map((p) => (p.id === doc.id ? doc : p)));
  }
  function newPage(parentId: string | null) {
    setTitle('');
    setError('');
    setCreating({ parentId });
  }
  function createPage(event: FormEvent) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    void action(async () => {
      const doc = await api.docsCreate(group.id, title.trim(), creating?.parentId || null);
      setPages((p) => [...p, doc]);
      setSelected(doc.id);
      setCreating(null);
    });
  }
  function command(id: string, kind: TreeCommand['kind']) {
    setSelected(id);
    setTreeCommand((current) => ({ id, kind, serial: (current?.serial ?? 0) + 1 }));
  }
  const children = useMemo(() => {
    const map = new Map<string | null, ProjectDocMetadata[]>();
    for (const doc of pages) {
      const siblings = map.get(doc.parentId) || [];
      siblings.push(doc);
      map.set(doc.parentId, siblings);
    }
    const titleOf = (doc: ProjectDocMetadata) => frozenTitles?.get(doc.id) ?? doc.title;
    for (const siblings of map.values()) siblings.sort((a, b) => compareDocs(a, b, titleOf));
    return map;
  }, [pages, frozenTitles]);
  /** Returns the function that moves a page up (-1) or down (1), if it can move. */
  function reorder(id: string, offset: -1 | 1) {
    const doc = pages.find((p) => p.id === id);
    if (!doc) return undefined;
    const siblings = children.get(doc.parentId) || [];
    const index = siblings.findIndex((p) => p.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= siblings.length) return undefined;
    return () => {
      const next = [...siblings];
      [next[index], next[target]] = [next[target], next[index]];
      void action(async () => {
        // Write the position of each sibling whose position changed. The open page saves
        // through its editor, so that the editor keeps the current revision.
        for (const [order, sibling] of next.entries()) {
          if (sibling.order === order) continue;
          if (sibling.id === page?.id)
            setTreeCommand((current) => ({
              id: sibling.id,
              kind: 'order',
              order,
              serial: (current?.serial ?? 0) + 1,
            }));
          else {
            const full = await api.docsRead(group.id, sibling.id);
            await api.docsSave(group.id, { ...full, order });
          }
          setPages((current) => current.map((p) => (p.id === sibling.id ? { ...p, order } : p)));
        }
      });
    };
  }
  const hasSubpages = !!page && !!children.get(page.id)?.length;
  useEffect(() => {
    const ancestors: string[] = [];
    let cursor = pages.find((p) => p.id === selected);
    const seen = new Set<string>();
    while (cursor?.parentId && !seen.has(cursor.parentId)) {
      seen.add(cursor.parentId);
      ancestors.push(cursor.parentId);
      cursor = pages.find((p) => p.id === cursor?.parentId);
    }
    setCollapsed((current) => {
      if (!ancestors.some((id) => current[id])) return current;
      return { ...current, ...Object.fromEntries(ancestors.map((id) => [id, false])) };
    });
  }, [selected, pages]);
  function tree(parentId: string | null, depth = 0, visited = new Set<string>()): ReactNode {
    return (children.get(parentId) || []).map((p) => {
      if (visited.has(p.id)) return null;
      const next = new Set(visited).add(p.id);
      const hasChildren = !!children.get(p.id)?.length;
      const up = reorder(p.id, -1);
      const down = reorder(p.id, 1);
      return (
        <li key={p.id}>
          <div className="wiki-tree-row row-focus" data-selected={selected === p.id}>
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon-2xs"
                className="wiki-tree-toggle size-4"
                aria-label={`Toggle ${p.title} subpages`}
                aria-expanded={!collapsed[p.id]}
                onClick={() => setCollapsed((c) => ({ ...c, [p.id]: !c[p.id] }))}
              >
                {collapsed[p.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </Button>
            ) : (
              <span className="wiki-tree-spacer" />
            )}
            <Button
              variant="bare"
              className="doc-tree-page h-8 min-w-0 flex-1 justify-start gap-2 rounded-none text-sm font-normal focus-visible:ring-0"
              title={p.title}
              aria-current={selected === p.id ? 'page' : undefined}
              onClick={() => setSelected(p.id)}
            >
              <FileText size={16} className="text-muted-foreground" />
              <span>{p.title}</span>
            </Button>
            <div className="wiki-tree-actions">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <MoreButton size="xs" label={`Actions for ${p.title}`} disabled={busy} />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={6}
                  onCloseAutoFocus={(event) => {
                    if (!focusTitle.current) return;
                    focusTitle.current = false;
                    event.preventDefault();
                  }}
                >
                  <DropdownMenuItem
                    onSelect={() => {
                      focusTitle.current = true;
                      command(p.id, 'rename');
                    }}
                  >
                    Rename page
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => command(p.id, 'move')}>
                    Move page
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!up} onSelect={() => up?.()}>
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!down} onSelect={() => down?.()}>
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => newPage(p.id)}>Add subpage</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => command(p.id, 'delete')}>
                    Delete page
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {hasChildren && !collapsed[p.id] && (
            <ul className="wiki-tree-children">{tree(p.id, depth + 1, next)}</ul>
          )}
        </li>
      );
    });
  }
  return (
    <section className="project-docs" aria-label="Project docs">
      {error && (
        <Alert variant="destructive" size="sm" className="mx-6 mt-3 w-auto">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div
        className="docs-layout"
        style={{ '--docs-library-width': `${width}px` } as CSSProperties}
      >
        <aside className="docs-library" aria-label="Document pages">
          <div className="wiki-pages-label">
            <h2 className="sidebar-label">Pages</h2>
            <Hint label="New page">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="New page"
                disabled={busy}
                onClick={() => newPage(null)}
              >
                <Plus size={14} />
              </Button>
            </Hint>
          </div>
          <nav className="wiki-tree-scroll" aria-label="Document structure">
            <ul className="wiki-page-tree">{tree(null)}</ul>
          </nav>
          <button
            type="button"
            className="wiki-tree-row docs-trash-row"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setDeletedPages(await api.docsTrash(group.id));
              })
            }
          >
            <Trash2 size={16} aria-hidden="true" /> Deleted pages
          </button>
          <LibraryResizer width={width} onResize={resizeLibrary} />
        </aside>
        {page && page.id === selected ? (
          <div
            className="doc-workspace"
            // The document bar shows its bottom border only after the page scrolls.
            onScroll={(e) =>
              e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 0)
            }
          >
            <DocEditor
              key={page.id}
              api={api}
              onTreeCommandHandled={() => setTreeCommand(undefined)}
              treeCommand={treeCommand}
              groupId={group.id}
              onNavigate={setSelected}
              onSubpage={() => newPage(page.id)}
              onReorder={{ up: reorder(page.id, -1), down: reorder(page.id, 1) }}
              onTitleEditing={(editing) =>
                setFrozenTitles(editing ? new Map(pages.map((doc) => [doc.id, doc.title])) : null)
              }
              initial={page}
              pages={pages}
              onSaved={saved}
              onDelete={() => {
                setError('');
                setDeleting(true);
              }}
            />
          </div>
        ) : (
          <div className="docs-empty">
            <EmptyState
              icon={<BookOpen />}
              title={
                loading || pageLoading
                  ? 'Loading pages…'
                  : pages.length
                    ? 'Select a page'
                    : 'No docs yet'
              }
              action={
                !loading &&
                !pageLoading &&
                !pages.length && (
                  <Button onClick={() => newPage(null)}>
                    <Plus size={16} /> Create your first page
                  </Button>
                )
              }
            >
              {!loading && !pageLoading
                ? pages.length
                  ? 'Select a page in the list.'
                  : 'Write plans, decisions and guides for this project.'
                : null}
            </EmptyState>
          </div>
        )}
      </div>
      <Dialog open={!!creating} onOpenChange={(open) => !open && !busy && setCreating(null)}>
        <DialogContent>
          <form className="contents" onSubmit={createPage}>
            <DialogHeader>
              <DialogTitle>{creating?.parentId ? 'New subpage' : 'New page'}</DialogTitle>
              <DialogDescription>Give this page a title.</DialogDescription>
            </DialogHeader>
            <Input
              aria-label="New page title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !title.trim()}>
                Create page
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting} onOpenChange={(open) => !busy && setDeleting(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{page?.title || 'Untitled'}”?</DialogTitle>
            <DialogDescription>
              {hasSubpages
                ? 'This page has subpages. Move or delete its subpages first.'
                : 'You can restore the page later from Deleted pages.'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            {hasSubpages ? (
              <Hint label="Move or delete its subpages first.">
                <Button variant="destructive" disabled>
                  Delete page
                </Button>
              </Hint>
            ) : (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (!page) return;
                    await api.docsDelete(group.id, page.id, page.revision);
                    setPages((p) => p.filter((d) => d.id !== page.id));
                    setSelected(pageAfterDelete(pages, page.id));
                    setDeleting(false);
                  })
                }
              >
                Delete page
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deletedPages !== null}
        onOpenChange={(open) => !open && !busy && setDeletedPages(null)}
      >
        <DialogContent layout="scroll">
          <DialogHeader>
            <DialogTitle>Deleted pages</DialogTitle>
            <DialogDescription>
              Restore a page to the project. A page goes to the top level if its parent page was
              deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {error && (
              <p role="alert" className="field-error mb-2">
                {error}
              </p>
            )}
            {deletedPages?.length ? (
              <ul className="wiki-deleted-list">
                {deletedPages.map((item) => (
                  <li key={item.trashId}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={item.title}>
                        {item.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Deleted {new Date(item.deletedAt).toLocaleString()}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Restore ${item.title}`}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const doc = await api.docsRestore(group.id, item.trashId);
                          setPages((current) => [
                            ...current,
                            {
                              id: doc.id,
                              title: doc.title,
                              parentId: doc.parentId,
                              order: doc.order,
                            },
                          ]);
                          setDeletedPages((current) =>
                            (current || []).filter((d) => d.trashId !== item.trashId),
                          );
                          setSelected(doc.id);
                        })
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact>No deleted pages.</EmptyState>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletedPages(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
