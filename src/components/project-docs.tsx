import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { WikiEditor } from './wiki-editor';
import { ActionMenu } from './action-menu';
import { BookOpen, FileText, Plus, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import type { API, ProjectGroup } from '../types';
import type { DeletedProjectDoc, ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import { hasPrimaryModifier } from '../lib/platform';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
import { Hint } from './hint';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { errorMessage } from '../lib/errors';

type TreeCommand = { id: string; kind: 'move' | 'rename' | 'delete'; serial: number };

function sortedSiblings(pages: ProjectDocMetadata[], parentId: string | null) {
  return pages
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => a.title.localeCompare(b.title));
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

const selectionKey = (groupId: string) => 'kalkidan-docs-selected:' + groupId;

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
  groupName,
  onSubpage,
  onNavigate,
  treeCommand,
  onTreeCommandHandled,
}: {
  onTreeCommandHandled: () => void;
  treeCommand?: TreeCommand;
  groupName: string;
  onSubpage: () => void;
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
    else rename();
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
    if (!value.title.trim()) {
      setStatus('Add a page title');
      return queue.current;
    }
    pending.current = null;
    queue.current = queue.current.then(async () => {
      if (failed.current) {
        pending.current ??= value;
        return;
      }
      try {
        const saved = await api.docsSave(groupId, { ...value, revision: revision.current });
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
      {recovery && (
        <div className="doc-alert">
          An unsaved draft is available.
          <Button
            variant="ghost"
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
        </div>
      )}
      <div className="wiki-document-bar">
        <nav className="wiki-breadcrumbs" aria-label="Document breadcrumb">
          <BookOpen size={15} aria-hidden="true" />
          <span>{groupName}</span>
          <ChevronRight size={13} aria-hidden="true" />
          {draft.parentId && (
            <>
              <button onClick={() => onNavigate(draft.parentId!)}>{parentTitle}</button>
              <ChevronRight size={13} aria-hidden="true" />
            </>
          )}
          <span aria-current="page">{draft.title || 'Untitled'}</span>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode(mode === 'read' ? 'write' : 'read')}
          >
            {mode === 'read' ? 'Edit' : 'Read'}
          </Button>
          <ActionMenu
            label="Document actions"
            items={[
              { label: 'Rename page', action: rename },
              { label: 'Move page', action: startMove },
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
              ...pages
                .filter((p) => {
                  let cursor: ProjectDocMetadata | undefined = p;
                  const seen = new Set<string>();
                  while (cursor) {
                    if (cursor.id === draft.id || seen.has(cursor.id)) return false;
                    seen.add(cursor.id);
                    cursor = pages.find((x) => x.id === cursor?.parentId);
                  }
                  return true;
                })
                .map((p) => ({ value: p.id, label: p.title })),
            ]}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              disabled={moveTarget === (draft.parentId || 'root')}
              onClick={() => {
                update({ ...latest.current, parentId: moveTarget === 'root' ? null : moveTarget });
                void flush();
                setMoving(false);
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && (
        <p role="alert" className="doc-alert">
          {error} Your draft is kept locally for recovery.
        </p>
      )}
      <div className="wiki-page">
        <Input
          ref={titleInput}
          className="doc-title"
          aria-label="Page title"
          value={draft.title}
          readOnly={mode === 'read'}
          onChange={(e) => update({ ...latest.current, title: e.target.value })}
          onBlur={() => void flush()}
        />
        {mode === 'source' ? (
          <textarea
            className="wiki-source"
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
          />
        )}
      </div>
    </section>
  );
}

export function ProjectDocsPanel({ api, group }: { api: API; group: ProjectGroup }) {
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
  }, [group.id, selected]);
  useEffect(() => {
    let live = true;
    api
      .docsMetadata(group.id)
      .then((value) => {
        if (live) {
          setPages(value);
          setSelected(initialPage(value, readSelection(group.id)));
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
    for (const siblings of map.values()) siblings.sort((a, b) => a.title.localeCompare(b.title));
    return map;
  }, [pages]);
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
  function tree(parentId: string | null, depth = 0, visited = new Set<string>()): React.ReactNode {
    return (children.get(parentId) || []).map((p) => {
      if (visited.has(p.id)) return null;
      const next = new Set(visited).add(p.id);
      const hasChildren = !!children.get(p.id)?.length;
      return (
        <li key={p.id}>
          <div className="wiki-tree-row" data-selected={selected === p.id}>
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Toggle ${p.title} subpages`}
                aria-expanded={!collapsed[p.id]}
                onClick={() => setCollapsed((c) => ({ ...c, [p.id]: !c[p.id] }))}
              >
                {collapsed[p.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </Button>
            ) : (
              <span className="wiki-tree-spacer" />
            )}
            <Button
              variant="ghost"
              className="doc-tree-page"
              title={p.title}
              aria-current={selected === p.id ? 'page' : undefined}
              onClick={() => setSelected(p.id)}
            >
              <FileText size={15} />
              <span>{p.title}</span>
            </Button>
            <div className="wiki-tree-actions">
              <ActionMenu
                restoreFocus={false}
                label={`Actions for ${p.title}`}
                disabled={busy}
                items={[
                  { label: 'Rename page', action: () => command(p.id, 'rename') },
                  { label: 'Move page', action: () => command(p.id, 'move') },
                  { label: 'Add subpage', action: () => newPage(p.id) },
                  { label: 'Delete page', danger: true, action: () => command(p.id, 'delete') },
                ]}
              />
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
        <p role="alert" className="doc-alert">
          {error}
        </p>
      )}
      <div className="docs-layout">
        <aside className="docs-library" aria-label="Document pages">
          <div className="wiki-pages-label">
            <Button
              variant="ghost"
              size="sm"
              className="wiki-new-page"
              aria-label="New page"
              disabled={busy}
              onClick={() => newPage(null)}
            >
              <Plus size={15} /> New page
            </Button>
          </div>
          <nav aria-label="Document structure">
            <ul className="wiki-page-tree">{tree(null)}</ul>
          </nav>
          <Button
            variant="ghost"
            size="sm"
            className="wiki-deleted-pages"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setDeletedPages(await api.docsTrash(group.id));
              })
            }
          >
            <Trash2 size={15} /> Deleted pages
          </Button>
        </aside>
        {page && page.id === selected ? (
          <div className="doc-workspace">
            <DocEditor
              key={page.id}
              api={api}
              onTreeCommandHandled={() => setTreeCommand(undefined)}
              treeCommand={treeCommand}
              groupId={group.id}
              groupName={group.name}
              onNavigate={setSelected}
              onSubpage={() => newPage(page.id)}
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
            <BookOpen size={32} />
            <h3>
              {loading || pageLoading
                ? 'Loading pages…'
                : pages.length
                  ? 'Select a page'
                  : 'Your project wiki starts here'}
            </h3>
            {!loading && !pageLoading && !!pages.length && <p>Select a page in the list.</p>}
            {!loading && !pageLoading && !pages.length && (
              <>
                <p>Create a page for plans, decisions, or guides.</p>
                <Button onClick={() => newPage(null)}>
                  <Plus size={15} /> Create your first page
                </Button>
              </>
            )}
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
              <p role="alert" className="doc-alert">
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
            <DialogTitle>Delete this page?</DialogTitle>
            <DialogDescription>
              {hasSubpages
                ? 'This page has subpages. Move or delete its subpages first.'
                : 'You can restore the page later from Deleted pages.'}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="doc-alert">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deleted pages</DialogTitle>
            <DialogDescription>
              Restore a page to the project. A page goes to the top level if its parent page was
              deleted.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="doc-alert">
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
                          { id: doc.id, title: doc.title, parentId: doc.parentId },
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
            <p className="text-sm text-muted-foreground">No deleted pages.</p>
          )}
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
