import { useEffect, useMemo, useRef, useState } from 'react';
import { WikiEditor } from './wiki-editor';
import { ActionMenu } from './action-menu';
import { BookOpen, FileText, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import type { API, ProjectGroup } from '../types';
import type { ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

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
  treeCommand?: { id: string; kind: 'move' | 'rename'; serial: number };
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
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (treeCommand?.id !== initial.id) return;
    if (treeCommand.kind === 'move') setMoving(true);
    else {
      setMode('write');
      requestAnimationFrame(() => {
        titleInput.current?.focus();
        titleInput.current?.select();
      });
    }
    onTreeCommandHandled();
  }, [treeCommand, initial.id]);
  const [editorVersion, setEditorVersion] = useState(0);
  const [status, setStatus] = useState('Saved');
  const revision = useRef(initial.revision);
  const latest = useRef(initial);
  const pending = useRef<ProjectDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
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
      if (failed.current) return;
      try {
        const saved = await api.docsSave(groupId, { ...value, revision: revision.current });
        revision.current = saved.revision;
        onSaved(saved);
        if (latest.current === value) {
          setStatus('Saved');
          localStorage.removeItem(recoveryKey);
        }
      } catch (e) {
        failed.current = true;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('Not saved');
      }
    });
    return queue.current;
  }
  function update(value: ProjectDoc) {
    latest.current = value;
    pending.current = value;
    setDraft(value);
    setStatus(failed.current ? 'Not saved' : 'Saving…');
    localStorage.setItem(recoveryKey, JSON.stringify(value));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }
  useEffect(() => {
    const unload = () => {
      void flush();
    };
    const saveKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
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
              localStorage.removeItem(recoveryKey);
              setRecovery(null);
            }}
          >
            Discard draft
          </Button>
        </div>
      )}
      <div className="wiki-document-bar">
        <nav className="wiki-breadcrumbs" aria-label="Document breadcrumb">
          <BookOpen size={15} />
          <span>{groupName}</span>
          <ChevronRight size={13} />
          {draft.parentId && (
            <>
              <button onClick={() => onNavigate(draft.parentId!)}>
                {pages.find((p) => p.id === draft.parentId)?.title}
              </button>
              <ChevronRight size={13} />
            </>
          )}
          <span>{draft.title || 'Untitled'}</span>
        </nav>
        <div className="wiki-document-actions">
          <span role="status">{status}</span>
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
              { label: 'Add subpage', action: onSubpage },
              { label: 'Move page', action: () => setMoving(true) },
              {
                label: mode === 'source' ? 'Rich text editor' : 'Markdown source',
                action: () => setMode(mode === 'source' ? 'write' : 'source'),
              },
              {
                label: 'Delete page',
                danger: true,
                action: () => {
                  void flush().then(() => {
                    if (!failed.current) onDelete();
                  });
                },
              },
            ]}
          />
        </div>
      </div>
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move page</DialogTitle>
            <DialogDescription>Choose where this page belongs.</DialogDescription>
          </DialogHeader>
          <Choice
            label="Parent page"
            value={draft.parentId || 'root'}
            onChange={(parent) => update({ ...draft, parentId: parent === 'root' ? null : parent })}
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
            <Button
              onClick={() => {
                void flush();
                setMoving(false);
              }}
            >
              Done
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
  const [treeCommand, setTreeCommand] = useState<{
    id: string;
    kind: 'move' | 'rename';
    serial: number;
  }>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [title, setTitle] = useState('');
  const [deleting, setDeleting] = useState(false);
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
        if (live) setError(error.message);
      })
      .finally(() => {
        if (live) setPageLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, group.id, selected]);
  useEffect(() => {
    let live = true;
    api
      .docsMetadata(group.id)
      .then((value) => {
        if (live) {
          setPages(value);
          setSelected(value[0]?.id || '');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function saved(doc: ProjectDoc) {
    setPage((current) => (current?.id === doc.id ? doc : current));
    setPages((current) => current.map((p) => (p.id === doc.id ? doc : p)));
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
                  {
                    label: 'Add subpage',
                    action: () => {
                      setTitle('');
                      setCreating({ parentId: p.id });
                    },
                  },
                  {
                    label: 'Rename page',
                    action: () => {
                      setSelected(p.id);
                      setTreeCommand({ id: p.id, kind: 'rename', serial: Date.now() });
                    },
                  },
                  {
                    label: 'Move page',
                    action: () => {
                      setSelected(p.id);
                      setTreeCommand({ id: p.id, kind: 'move', serial: Date.now() });
                    },
                  },
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
              onClick={() => {
                setTitle('');
                setCreating({ parentId: null });
              }}
            >
              <Plus size={15} /> New page
            </Button>
          </div>
          <nav aria-label="Document structure">
            <ul className="wiki-page-tree">{tree(null)}</ul>
          </nav>
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
              onSubpage={() => {
                setTitle('');
                setCreating({ parentId: page.id });
              }}
              initial={page}
              pages={pages}
              onSaved={saved}
              onDelete={() => setDeleting(true)}
            />
          </div>
        ) : (
          <div className="docs-empty">
            <BookOpen size={32} />
            <h3>{loading || pageLoading ? 'Loading pages…' : 'Your project wiki starts here'}</h3>
            {!loading && !pageLoading && (
              <>
                <p>Create a page for plans, decisions, or guides.</p>
                <Button
                  onClick={() => {
                    setTitle('');
                    setCreating({ parentId: null });
                  }}
                >
                  <Plus size={15} /> Create your first page
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <Dialog open={!!creating} onOpenChange={(open) => !open && !busy && setCreating(null)}>
        <DialogContent>
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
            <Button variant="ghost" onClick={() => setCreating(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !title.trim()}
              onClick={() =>
                void action(async () => {
                  const doc = await api.docsCreate(
                    group.id,
                    title.trim(),
                    creating?.parentId || null,
                  );
                  setPages((p) => [...p, doc]);
                  setSelected(doc.id);
                  setCreating(null);
                })
              }
            >
              Create page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this page?</DialogTitle>
            <DialogDescription>
              Move or delete its subpages first. Deleted Markdown files are kept in the project's
              .trash folder.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="doc-alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (!page) return;
                  await api.docsDelete(group.id, page.id, page.revision);
                  setPages((p) => p.filter((d) => d.id !== page.id));
                  setSelected('');
                  setDeleting(false);
                })
              }
            >
              Delete page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
