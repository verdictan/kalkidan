import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { DocSaveMachine } from '../domain/doc-save';
import { WikiEditor } from './wiki-editor';
import { useProjectResource, setProjectResource } from '../hooks/use-project-resource';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FilePlus,
  FileText,
  FolderInput,
  ListChecks,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { API, ProjectGroup, TrackerItem } from '../types';
import { trackerConnection } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import { useProjectBoard } from '../hooks/use-project-board';
import { DocsToIssuesDialog } from './planning-tools';
import { SectionHeader } from './ui/page-header';
import type { DeletedProjectDoc, ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import { hasPrimaryModifier } from '../lib/platform';
import { Button } from './ui/button';
import { SegmentedControl } from './ui/segmented-control';
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
  DropdownMenuSeparator,
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

/** The label of a board task in docs: "#12 Title", or only the title for a draft. */
export function taskLabel(task: Pick<TrackerItem, 'number' | 'title'>) {
  return task.number ? `#${task.number} ${task.title}` : task.title;
}

/** Returns the board tasks that link to a doc page, in board order. */
export function tasksForPage(
  pageId: string,
  links: Record<string, string[]> | undefined,
  tasks: TrackerItem[] | null | undefined,
) {
  if (!links || !tasks) return [];
  return tasks.filter((task) => links[task.id]?.includes(pageId));
}

const openTask = (groupId: string, itemId: string) =>
  window.dispatchEvent(new CustomEvent('kalkidan-open-task', { detail: { groupId, itemId } }));

/** Alerts in the editor: under the document bar, at the width of the text column. */
const docAlertClass = 'mx-auto mt-3 w-[min(var(--reading-width),calc(100%-3rem))]';

const selectionKey = (groupId: string) => 'kalkidan-docs-selected:' + groupId;
const libraryWidthKey = 'kalkidan-docs-library-width';
const libraryHiddenKey = 'kalkidan-docs-library-hidden';

type EditorMode = 'write' | 'read' | 'source';
const modeOptions: { value: EditorMode; label: string }[] = [
  { value: 'write', label: 'Edit' },
  { value: 'read', label: 'Preview' },
  { value: 'source', label: 'Markdown' },
];

/** Returns the ancestors of a page, from the top-level page down to the parent. */
export function pageAncestors(pages: ProjectDocMetadata[], id: string) {
  const result: ProjectDocMetadata[] = [];
  const seen = new Set([id]);
  let parentId = pages.find((p) => p.id === id)?.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = pages.find((p) => p.id === parentId);
    if (!parent) break;
    result.unshift(parent);
    parentId = parent.parentId;
  }
  return result;
}

/**
 * Why "Create tasks from this page" is not available, or undefined when it is. The item always
 * shows, so that users can find it.
 */
export function planTasksReason(connected: boolean, writable: boolean | undefined) {
  if (!connected) return 'Connect a board first';
  if (writable === false) return 'You can only read this board';
  return undefined;
}

function readLibraryHidden() {
  try {
    return localStorage.getItem(libraryHiddenKey) === '1';
  } catch {
    return false;
  }
}

/** A menu item with a 16px icon. A disabled item shows the reason as a second line. */
function MenuAction({
  icon: Icon,
  label,
  onSelect,
  disabled,
  reason,
  destructive,
}: {
  icon: typeof Plus;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  reason?: string;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuItem
      variant={destructive ? 'destructive' : 'default'}
      disabled={disabled}
      className={disabled && reason ? 'h-auto items-start py-1.5' : undefined}
      onSelect={onSelect}
    >
      <Icon className={disabled && reason ? 'mt-0.5 size-4' : 'size-4'} aria-hidden="true" />
      {disabled && reason ? (
        <span className="grid">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">{reason}</span>
        </span>
      ) : (
        label
      )}
    </DropdownMenuItem>
  );
}
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
  storageIdentity,
  onCopied,
  onDirtyChange,
  initial,
  onSaved,
  onDelete,
  pages,
  onSubpage,
  onNavigate,
  onReorder,
  onTitleEditing,
  heading,
  treeCommand,
  onTreeCommandHandled,
  onAskAgent,
  onPlanTasks,
  planTasksDisabled,
  pagesToggle,
  tasks,
  linkedTasks,
}: {
  /** Starts a new chat with this page attached. */
  onAskAgent: (doc: ProjectDoc) => void;
  /** Opens the planner for this page. */
  onPlanTasks: () => void;
  /** Why the planner is not available. Undefined when it is available. */
  planTasksDisabled?: string;
  /** The button that shows the page list. It shows in the document bar while the list is hidden. */
  pagesToggle?: ReactNode;
  /** The board tasks for "/task". Undefined: no board. Null: the board loads. */
  tasks?: TrackerItem[] | null;
  /** The board tasks that link to this page. */
  linkedTasks: TrackerItem[];
  /** Scrolls to the heading with this text. The serial repeats a request for the same text. */
  heading?: { text: string; serial: number };
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
  storageIdentity: string;
  onCopied: (doc: ProjectDoc) => void;
  onDirtyChange: (dirty: boolean) => void;
  initial: ProjectDoc;
  onSaved: (doc: ProjectDoc) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<EditorMode>('write');
  const [moving, setMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState('root');
  const titleInput = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Scroll to the requested heading. The editor renders after mount, so try for a short time.
  useEffect(() => {
    if (!heading?.text) return;
    const wanted = heading.text.trim().toLowerCase();
    let frame = 0;
    let tries = 0;
    const find = () => {
      const target = [
        ...(body.current?.querySelectorAll<HTMLElement>(
          '.ProseMirror :is(h1, h2, h3, h4, h5, h6)',
        ) || []),
      ].find((node) => node.textContent?.trim().toLowerCase() === wanted);
      if (target) target.scrollIntoView({ block: 'start' });
      else if (tries++ < 30) frame = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [heading?.serial]);
  /** Moves focus from the title to the text of the page. */
  function focusBody() {
    body.current?.querySelector<HTMLElement>('.ProseMirror, .wiki-source')?.focus();
  }
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
    if (recovery) {
      setActionError('Restore or discard the recovered draft first.');
      return;
    }
    void flush().then(() => {
      if (machine.read().status === 'clean') onDelete();
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recoveryKey = 'kalkidan-doc-draft:' + storageIdentity + ':' + initial.id;
  const legacyRecoveryKey = 'kalkidan-doc-draft:' + groupId + ':' + initial.id;
  const legacyClaimed = useRef(false);
  function storeDraft(value: ProjectDoc | null) {
    try {
      if (value) localStorage.setItem(recoveryKey, JSON.stringify(value));
      else {
        localStorage.removeItem(recoveryKey);
        if (legacyClaimed.current) localStorage.removeItem(legacyRecoveryKey);
      }
    } catch {
      /* Autosave remains available when browser storage is full. */
    }
  }
  const [recovery, setRecovery] = useState<ProjectDoc | null>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(recoveryKey) || localStorage.getItem(legacyRecoveryKey) || 'null',
      );
      return value?.id === initial.id &&
        typeof value.markdown === 'string' &&
        typeof value.title === 'string' &&
        typeof value.revision === 'string' &&
        value.markdown.length <= 2000000
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [machine] = useState(
    () => new DocSaveMachine(initial, (doc) => api.docsSave(groupId, doc), onSaved, storeDraft),
  );
  const saveState = useSyncExternalStore(machine.subscribe, machine.read);
  useEffect(() => {
    onDirtyChange(saveState.status !== 'clean' || !!recovery);
  }, [saveState.status, recovery]);
  const draft = saveState.draft;
  const latest = useRef(draft);
  latest.current = draft;
  // The title field keeps the typed text. An empty title is not saved: the page keeps its last
  // title, and the field shows it again when it loses focus.
  const [titleText, setTitleText] = useState(draft.title);
  const editingTitle = useRef(false);
  useEffect(() => {
    if (!editingTitle.current) setTitleText(draft.title);
  }, [draft.title]);
  const [actionError, setActionError] = useState('');
  const [resolving, setResolving] = useState(false);
  const copy = useRef<ProjectDoc | null>(null);
  const error = actionError || saveState.error || '';
  const status =
    saveState.status === 'clean'
      ? 'Saved'
      : ['dirty', 'saving'].includes(saveState.status)
        ? 'Saving…'
        : 'Not saved';
  const conflict = ['conflict', 'deleted'].includes(saveState.status);
  useEffect(() => {
    if (!recovery) machine.refresh(initial);
  }, [initial.revision, recovery]);
  function flush() {
    clearTimeout(timer.current);
    return machine.flush();
  }
  function retry() {
    void machine.retry();
  }
  function update(value: ProjectDoc) {
    if (recovery) return;
    machine.edit(value);
    latest.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }
  async function resolveConflict(asCopy: boolean) {
    if (resolving) return;
    setResolving(true);
    setActionError('');
    try {
      if (asCopy) {
        copy.current ??= await api.docsCreate(
          groupId,
          (latest.current.title || 'Untitled') + ' (recovered)',
          null,
        );
        const saved = await api.docsSave(groupId, {
          ...copy.current,
          markdown: latest.current.markdown,
        });
        storeDraft(null);
        onCopied(saved);
      } else {
        machine.discard(await api.docsRead(groupId, initial.id));
        setRecovery(null);
        setEditorVersion((v) => v + 1);
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setResolving(false);
    }
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
  const ancestors = pageAncestors(
    pages.map((p) => (p.id === draft.id ? { ...p, parentId: draft.parentId } : p)),
    draft.id,
  );
  return (
    <section className="doc-editor" aria-label="Document editor">
      <div className="wiki-document-bar">
        <div className="wiki-document-bar-inner">
          {pagesToggle}
          {/* The title bar shows the project, Docs and the page. Here, show only the ancestors. */}
          {ancestors.length > 0 ? (
            <nav className="wiki-breadcrumbs" aria-label="Document breadcrumb">
              {ancestors.map((ancestor) => (
                <span key={ancestor.id} className="contents">
                  <button title={ancestor.title} onClick={() => onNavigate(ancestor.id)}>
                    {ancestor.title || 'Untitled'}
                  </button>
                  <ChevronRight size={12} aria-hidden="true" />
                </span>
              ))}
            </nav>
          ) : (
            <span className="flex-1" />
          )}
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
            {saveState.status === 'save-error' && (
              <Button variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            )}
            <SegmentedControl
              size="sm"
              label="View"
              value={mode}
              onChange={setMode}
              options={modeOptions}
            />
            <DropdownMenu>
              <Hint label="Document actions">
                <DropdownMenuTrigger asChild>
                  <MoreButton label="Document actions" />
                </DropdownMenuTrigger>
              </Hint>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                <MenuAction
                  icon={MessageSquare}
                  label="Ask an agent about this page"
                  onSelect={() => void flush().then(() => onAskAgent(latest.current))}
                />
                <MenuAction
                  icon={ListChecks}
                  label="Create tasks from this page…"
                  disabled={!!planTasksDisabled}
                  reason={planTasksDisabled}
                  onSelect={() => void flush().then(onPlanTasks)}
                />
                <DropdownMenuSeparator />
                <MenuAction icon={Pencil} label="Rename page" onSelect={rename} />
                <MenuAction icon={FolderInput} label="Move page" onSelect={startMove} />
                <MenuAction
                  icon={ArrowUp}
                  label="Move up"
                  disabled={!onReorder.up}
                  onSelect={() => onReorder.up?.()}
                />
                <MenuAction
                  icon={ArrowDown}
                  label="Move down"
                  disabled={!onReorder.down}
                  onSelect={() => onReorder.down?.()}
                />
                <MenuAction icon={FilePlus} label="Add subpage" onSelect={onSubpage} />
                <DropdownMenuSeparator />
                <MenuAction
                  icon={Trash2}
                  label="Delete page"
                  destructive
                  onSelect={requestDelete}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
                disabled={['saving', 'dirty'].includes(saveState.status)}
                onClick={() => {
                  legacyClaimed.current = true;
                  machine.restore(recovery);
                  latest.current = recovery;
                  void flush();
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
                  legacyClaimed.current = true;
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
      {conflict && (
        <Alert size="sm" className={docAlertClass}>
          <AlertDescription className="doc-alert-body">
            {saveState.status === 'deleted'
              ? 'This page was deleted.'
              : 'This page changed on disk.'}{' '}
            Your draft has not replaced it.
            <span className="doc-alert-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={resolving}
                onClick={() => void resolveConflict(true)}
              >
                Save as new page
              </Button>
              {saveState.status !== 'deleted' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={resolving}
                  onClick={() => void resolveConflict(false)}
                >
                  Discard draft and reload
                </Button>
              )}
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
        <DialogContent layout="scroll">
          <DialogHeader>
            <DialogTitle>Move page</DialogTitle>
            <DialogDescription>Choose the parent page for this page.</DialogDescription>
          </DialogHeader>
          <DialogBody>
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
          </DialogBody>
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
      <div className="wiki-page" ref={body}>
        <input
          ref={titleInput}
          className="doc-title"
          aria-label="Page title"
          placeholder="Untitled"
          maxLength={200}
          value={titleText}
          readOnly={mode === 'read' || resolving || !!recovery}
          onChange={(e) => {
            setTitleText(e.target.value);
            if (e.target.value.trim()) update({ ...latest.current, title: e.target.value });
          }}
          onFocus={() => {
            editingTitle.current = true;
            onTitleEditing(true);
          }}
          onKeyDown={(e) => {
            // Enter moves to the text of the page. The title keeps all typed text.
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            focusBody();
          }}
          onBlur={() => {
            editingTitle.current = false;
            setTitleText(latest.current.title);
            onTitleEditing(false);
            void flush();
          }}
        />
        {mode === 'source' ? (
          <textarea
            className="wiki-source font-mono"
            aria-label="Markdown content"
            readOnly={resolving || !!recovery}
            value={draft.markdown}
            onChange={(e) => update({ ...latest.current, markdown: e.target.value })}
            onBlur={() => void flush()}
          />
        ) : (
          <WikiEditor
            key={editorVersion}
            markdown={draft.markdown}
            readOnly={mode === 'read' || resolving || !!recovery}
            onChange={(markdown) => update({ ...latest.current, markdown })}
            groupId={groupId}
            onOpenPage={(id) => {
              if (pages.some((p) => p.id === id)) onNavigate(id);
              else showToast({ message: 'This page is not in these docs.', tone: 'error' });
            }}
            tasks={tasks}
            api={api}
            onOpenTask={(itemId) => openTask(groupId, itemId)}
          />
        )}
        {linkedTasks.length > 0 && (
          <section className="doc-linked-tasks" aria-label="Linked tasks">
            <SectionHeader size="sm" title="Linked tasks" count={linkedTasks.length} />
            <ul className="list-box doc-linked-task-list">
              {linkedTasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className="list-box-row row-hover"
                    title={task.title}
                    onClick={() => openTask(groupId, task.id)}
                  >
                    <CircleDot size={16} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{taskLabel(task)}</span>
                    {task.status && (
                      <span className="text-subtle shrink-0 text-xs">{task.status}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

export function ProjectDocsPanel({
  api,
  group,
  initialPageId,
  initialHeading,
}: {
  api: API;
  group: ProjectGroup;
  /** Opens this page, for example from a search result. */
  initialPageId?: string;
  /** Scrolls the opened page to the heading with this text. */
  initialHeading?: string;
}) {
  const [selected, setSelected] = useState('');
  const [heading, setHeading] = useState<{ text: string; serial: number } | undefined>(
    initialHeading ? { text: initialHeading, serial: 1 } : undefined,
  );
  useEffect(() => {
    if (initialHeading)
      setHeading((current) => ({ text: initialHeading, serial: (current?.serial ?? 0) + 1 }));
  }, [initialHeading]);
  // Other pages can open a doc page of this project, and a heading on it.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (
        event as CustomEvent<{ groupId?: string; page?: string; docId?: string; heading?: string }>
      ).detail;
      if (detail?.groupId !== group.id || detail.page !== 'docs') return;
      if (detail.docId) setSelected(detail.docId);
      if (detail.heading)
        setHeading((current) => ({
          text: detail.heading!,
          serial: (current?.serial ?? 0) + 1,
        }));
    };
    window.addEventListener('kalkidan-open-project-page', open);
    return () => window.removeEventListener('kalkidan-open-project-page', open);
  }, [group.id]);
  const dirtyPages = useRef(new Set<string>());
  const metadata = useProjectResource(api, group, 'docs-metadata', () =>
    api.docsMetadata(group.id),
  );
  const pages = metadata.state.value || [];
  const setPages = (fn: (pages: ProjectDocMetadata[]) => ProjectDocMetadata[]) =>
    metadata.update((previous) => fn(previous || []));
  const content = useProjectResource(
    api,
    group,
    'docs-page',
    () => api.docsRead(group.id, selected),
    selected,
    !!selected && pages.some((p) => p.id === selected),
  );
  const page = content.state.value || null;
  // The breadcrumb of the shell shows the open page. Tell it the page and its current title.
  const selectedTitle = pages.find((p) => p.id === selected)?.title;
  useEffect(() => {
    if (!selected || selectedTitle === undefined) return;
    window.dispatchEvent(
      new CustomEvent('kalkidan-doc-selected', {
        detail: { groupId: group.id, docId: selected, title: selectedTitle || 'Untitled' },
      }),
    );
  }, [group.id, selected, selectedTitle]);
  const [treeCommand, setTreeCommand] = useState<TreeCommand>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const loading = ['idle', 'loading'].includes(metadata.state.status);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [libraryHidden, setLibraryHidden] = useState(readLibraryHidden);
  const [deletedPages, setDeletedPages] = useState<DeletedProjectDoc[] | null>(null);
  const pageLoading = ['idle', 'loading'].includes(content.state.status) && !!selected;
  // While a title is edited, the list sorts by the titles from before the edit.
  const [frozenTitles, setFrozenTitles] = useState<Map<string, string> | null>(null);
  const [width, setWidth] = useState(readLibraryWidth);
  // Only Rename moves focus to the page title. Other menu items return focus to the menu.
  const focusTitle = useRef(false);
  // After New page, focus goes to the title of the new page, not back to the page list.
  const createdPage = useRef<string | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const [planning, setPlanning] = useState(false);
  const connection = trackerConnection(group);
  const provider = connection?.provider || 'github';
  const client = useMemo(() => trackerClient(api, provider), [api, provider]);
  const board = useProjectBoard(api, client, provider, group.id, connection?.project);
  // A loaded board without write access cannot get tasks. Before it loads, the dialog checks.
  const planReason = planTasksReason(
    !!connection,
    board.state.value ? !!board.state.value.writable : undefined,
  );
  const boardTasks: TrackerItem[] | null | undefined = !connection
    ? undefined
    : board.state.value
      ? board.state.value.items
      : board.state.status === 'error'
        ? []
        : null;
  const [taskLinks, setTaskLinks] = useState<Record<string, string[]>>();
  useEffect(() => {
    if (!connection || !api.taskDocLinks) return;
    let live = true;
    api
      .taskDocLinks(group.id)
      .then((links) => live && setTaskLinks(links))
      .catch(() => live && setTaskLinks(undefined));
    return () => {
      live = false;
    };
  }, [api, group.id, !!connection, selected]);
  function askAgent(doc: ProjectDoc) {
    window.dispatchEvent(
      new CustomEvent('kalkidan-new-session', {
        detail: {
          groupId: group.id,
          docIds: [doc.id],
          prompt: `Read the attached page "${doc.title || 'Untitled'}". `,
        },
      }),
    );
  }
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
    setError(metadata.state.error || content.state.error || '');
  }, [metadata.state.error, content.state.error]);
  useEffect(() => {
    if (selected) writeSelection(group.id, selected);
    setFrozenTitles(null);
  }, [group.id, selected]);
  useEffect(() => {
    if (
      metadata.state.value &&
      !pages.some((p) => p.id === selected) &&
      !dirtyPages.current.has(selected)
    )
      setSelected(initialPage(pages, initialPageId || readSelection(group.id)));
  }, [group.id, metadata.state.value]);
  useEffect(() => {
    if (initialPageId && pages.some((p) => p.id === initialPageId)) setSelected(initialPageId);
  }, [initialPageId, pages.length > 0]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      void metadata.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function saved(doc: ProjectDoc) {
    if (selected === doc.id) content.update(doc);
    setPages((current) => current.map((p) => (p.id === doc.id ? doc : p)));
  }
  /** Creates an "Untitled" page at once. Focus then goes to its title, with the text selected. */
  function newPage(parentId: string | null) {
    if (busy) return;
    void action(async () => {
      const doc = await api.docsCreate(group.id, 'Untitled', parentId);
      setProjectResource(api, group, 'docs-page', doc, doc.id);
      setPages((p) => [...p.filter((page) => page.id !== doc.id), doc]);
      if (parentId) setCollapsed((c) => ({ ...c, [parentId]: false }));
      createdPage.current = doc.id;
      setSelected(doc.id);
    });
  }
  // Focus the title of the new page when its editor shows. Typing replaces "Untitled".
  const openPageId = page && page.id === selected ? page.id : '';
  useEffect(() => {
    if (!openPageId || createdPage.current !== openPageId) return;
    createdPage.current = null;
    const frame = requestAnimationFrame(() => {
      const input = workspace.current?.querySelector<HTMLInputElement>('.doc-title');
      input?.focus();
      input?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [openPageId]);
  function toggleLibrary(hidden: boolean) {
    setLibraryHidden(hidden);
    try {
      localStorage.setItem(libraryHiddenKey, hidden ? '1' : '0');
    } catch {
      // Storage can be unavailable. The list then shows on the next visit.
    }
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
  const hasPages = pages.length > 0;
  // The list always shows when no page is open: then it is the only way to open a page.
  const showLibrary = !libraryHidden || !(page && page.id === selected);
  const libraryId = 'docs-library-' + group.id;
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
                  <MenuAction
                    icon={Pencil}
                    label="Rename page"
                    onSelect={() => {
                      focusTitle.current = true;
                      command(p.id, 'rename');
                    }}
                  />
                  <MenuAction
                    icon={FolderInput}
                    label="Move page"
                    onSelect={() => command(p.id, 'move')}
                  />
                  <MenuAction
                    icon={ArrowUp}
                    label="Move up"
                    disabled={!up}
                    onSelect={() => up?.()}
                  />
                  <MenuAction
                    icon={ArrowDown}
                    label="Move down"
                    disabled={!down}
                    onSelect={() => down?.()}
                  />
                  <MenuAction
                    icon={FilePlus}
                    label="Add subpage"
                    onSelect={() => {
                      focusTitle.current = true;
                      newPage(p.id);
                    }}
                  />
                  <DropdownMenuSeparator />
                  <MenuAction
                    icon={Trash2}
                    label="Delete page"
                    destructive
                    onSelect={() => command(p.id, 'delete')}
                  />
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
        data-library={!hasPages ? 'none' : showLibrary ? undefined : 'hidden'}
        style={{ '--docs-library-width': `${width}px` } as CSSProperties}
      >
        {hasPages && showLibrary && (
          <aside id={libraryId} className="docs-library" aria-label="Document pages">
            <div className="wiki-pages-label">
              <h2 className="sidebar-label">Pages</h2>
              <span className="flex items-center gap-0.5">
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
                <Hint label="Hide pages">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Hide pages"
                    aria-expanded="true"
                    aria-controls={libraryId}
                    onClick={() => toggleLibrary(true)}
                  >
                    <PanelLeftClose size={14} />
                  </Button>
                </Hint>
              </span>
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
        )}
        {page && page.id === selected ? (
          <div
            ref={workspace}
            className="doc-workspace"
            // The document bar shows its bottom border only after the page scrolls.
            onScroll={(e) =>
              e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 0)
            }
          >
            <DocEditor
              key={JSON.stringify([group.hostId, group.rootPath, group.id, page.id])}
              api={api}
              onTreeCommandHandled={() => setTreeCommand(undefined)}
              treeCommand={treeCommand}
              groupId={group.id}
              onDirtyChange={(dirty) => {
                if (dirty) dirtyPages.current.add(page.id);
                else dirtyPages.current.delete(page.id);
              }}
              storageIdentity={JSON.stringify([group.hostId || '', group.rootPath || '', group.id])}
              onCopied={(doc) => {
                setProjectResource(api, group, 'docs-page', doc, doc.id);
                setPages((pages) => [...pages.filter((page) => page.id !== doc.id), doc]);
                setSelected(doc.id);
              }}
              onNavigate={setSelected}
              onSubpage={() => newPage(page.id)}
              onReorder={{ up: reorder(page.id, -1), down: reorder(page.id, 1) }}
              onTitleEditing={(editing) =>
                setFrozenTitles(editing ? new Map(pages.map((doc) => [doc.id, doc.title])) : null)
              }
              initial={page}
              pages={pages}
              onSaved={saved}
              onAskAgent={askAgent}
              onPlanTasks={() => setPlanning(true)}
              planTasksDisabled={planReason}
              pagesToggle={
                showLibrary ? undefined : (
                  <Hint label="Show pages">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 shrink-0"
                      aria-label="Show pages"
                      aria-expanded="false"
                      aria-controls={libraryId}
                      onClick={() => toggleLibrary(false)}
                    >
                      <PanelLeftOpen size={16} />
                      Pages
                    </Button>
                  </Hint>
                )
              }
              tasks={boardTasks}
              linkedTasks={tasksForPage(page.id, taskLinks, boardTasks)}
              heading={heading}
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
                  <Button disabled={busy} onClick={() => newPage(null)}>
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
      {connection && !planReason && (
        <DocsToIssuesDialog
          api={api}
          group={group}
          open={planning}
          onOpenChange={setPlanning}
          pageId={page?.id}
        />
      )}
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
                          setProjectResource(api, group, 'docs-page', doc, doc.id);
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
        </DialogContent>
      </Dialog>
    </section>
  );
}
