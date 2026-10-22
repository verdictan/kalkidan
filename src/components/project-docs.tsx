import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from 'react';
import { ContextMenu } from 'radix-ui';
import { DocSaveMachine } from '../domain/doc-save';
import { WikiEditor, TaskPicker, type WikiEditorActions } from './wiki-editor';
import { useProjectResource, setProjectResource } from '../hooks/use-project-resource';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code,
  FilePlus,
  FileText,
  FolderInput,
  Link2,
  ListChecks,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { API, ProjectGroup, TrackerItem } from '../types';
import { trackerConnection } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import { useProjectBoard } from '../hooks/use-project-board';
import { DocsToIssuesDialog, pageTasks } from './docs-to-issues';
import type { DeletedProjectDoc, ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import { hasPrimaryModifier, plural } from '../lib/platform';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { showToast } from './ui/toast';
import { Choice } from './choice';
import { Hint } from './hint';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { MoreButton } from './ui/more-button';
import {
  menuCollisionPadding,
  menuContentClass,
  menuDestructiveClass,
  menuItemClass,
  menuSeparatorClass,
} from './ui/menu-styles';
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
  kind: 'move' | 'delete' | 'order';
  /** The new sibling position for kind 'order'. */
  order?: number;
  /** The new parent for kind 'order', when the page moves to other siblings. */
  parentId?: string | null;
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

/**
 * The new order of a parent's pages after page `id` moves before or after `targetId`. The moved
 * page gets the parent of the target. Returns null when the move is not possible, for example a
 * move into a subpage of the page itself.
 */
export function placedSiblings(
  pages: ProjectDocMetadata[],
  id: string,
  targetId: string,
  position: 'before' | 'after',
) {
  const page = pages.find((p) => p.id === id);
  const target = pages.find((p) => p.id === targetId);
  if (!page || !target || id === targetId) return null;
  if (pageAncestors(pages, targetId).some((p) => p.id === id)) return null;
  const siblings = sortedSiblings(pages, target.parentId).filter((p) => p.id !== id);
  const index = siblings.findIndex((p) => p.id === targetId) + (position === 'after' ? 1 : 0);
  siblings.splice(index, 0, { ...page, parentId: target.parentId });
  return siblings;
}

const openTask = (groupId: string, itemId: string) =>
  window.dispatchEvent(new CustomEvent('kalkidan-open-task', { detail: { groupId, itemId } }));

const connectBoard = (groupId: string) =>
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-settings', { detail: { groupId, section: 'board' } }),
  );

/** Alerts in the editor: under the document bar, at the width of the text column. */
const docAlertClass = 'mx-auto mt-3 w-[min(var(--reading-width),calc(100%-3rem))]';

const selectionKey = (groupId: string) => 'kalkidan-docs-selected:' + groupId;

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
 * Why "Make tasks" cannot run now, or undefined when it can. Without a board, the action stays
 * available: it opens Connect board first.
 */
export function planTasksReason(connected: boolean, writable: boolean | undefined) {
  if (!connected) return 'Connect a board first';
  if (writable === false) return 'You can only read this board';
  return undefined;
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

/** One group of the Knowledge rail: a label with actions, then its rows. */
export function KnowledgeRailGroup({
  label,
  actions,
  children,
}: {
  label: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="knowledge-rail-group" aria-label={label}>
      <div className="knowledge-rail-label">
        <h2 className="sidebar-label">{label}</h2>
        {actions && <span className="knowledge-rail-actions">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

/** The page and task actions that the editor gets from the docs page. */
interface PageActions {
  /** Starts a new chat with this page attached. With text, the chat asks about that text. */
  onAskAgent: (doc: ProjectDoc, text?: string) => void;
  /** Opens "Create tasks from a doc page" for this page. */
  onPlanTasks: () => void;
  /** Why "Make tasks" cannot run, for example on a read-only board. */
  planTasksDisabled?: string;
  /** Opens Connect board. Undefined when the project has a board. */
  onConnectBoard?: () => void;
  onLinkTask: (task: TrackerItem) => void;
  onUnlinkTask: (task: TrackerItem) => void;
  /** Makes a board task from selected text. */
  onMakeTask: (text: string) => void;
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
  onTitleEditing,
  heading,
  treeCommand,
  onTreeCommandHandled,
  actions,
  switcher,
  tasks,
  linkedTasks,
  readCount,
}: {
  actions: PageActions;
  /** The Knowledge switcher. It shows in the document bar in a narrow window. */
  switcher?: ReactNode;
  /** The board tasks for "/" and the task picker. Undefined: no board. Null: the board loads. */
  tasks?: TrackerItem[] | null;
  /** The board tasks that link to this page. */
  linkedTasks: TrackerItem[];
  /** The number of chats that read this page. */
  readCount?: number;
  /** Scrolls to the heading with this text. The serial repeats a request for the same text. */
  heading?: { text: string; serial: number };
  onTreeCommandHandled: () => void;
  treeCommand?: TreeCommand;
  onSubpage: () => void;
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
  // One live editor. "View Markdown" shows the Markdown text of the page instead.
  const [source, setSource] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState('root');
  const [picking, setPicking] = useState(false);
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
    else {
      update({
        ...latest.current,
        order: treeCommand.order,
        ...(treeCommand.parentId !== undefined ? { parentId: treeCommand.parentId } : {}),
      });
      void flush();
    }
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
  // "Saved" shows for 2 seconds after each save, then fades. The key starts the fade again.
  const [savedSerial, setSavedSerial] = useState(0);
  useEffect(() => {
    if (saveState.status === 'clean') setSavedSerial((value) => value + 1);
  }, [saveState.status]);
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
  const readOnly = resolving || !!recovery;
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
  const taskCount = useMemo(
    () => pageTasks(draft.markdown, draft.title || 'Untitled').length,
    [draft.markdown, draft.title],
  );
  const askAgent = (text?: string) =>
    void flush().then(() => actions.onAskAgent(latest.current, text));
  const makeTasks = () => void flush().then(actions.onPlanTasks);
  const linkTask = () => (actions.onConnectBoard ? actions.onConnectBoard() : setPicking(true));
  const editorActions: WikiEditorActions = {
    taskCount,
    onMakeTasks: makeTasks,
    onAskAgent: () => askAgent(),
    onLinkTask: actions.onLinkTask,
    onConnectBoard: actions.onConnectBoard,
    onMakeTask: actions.onMakeTask,
    onAskSelection: (text) => askAgent(text),
  };
  const linked = new Set(linkedTasks.map((task) => task.id));
  return (
    <section className="doc-editor" aria-label="Document editor">
      <div className="wiki-document-bar">
        <div className="wiki-document-bar-inner">
          {switcher}
          {/* The ancestors of the page. The page title is the field under the bar. */}
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
            <span
              key={status === 'Saved' ? savedSerial : status}
              role="status"
              aria-live="off"
              className="doc-save-state"
              data-state={status === 'Saved' ? 'saved' : undefined}
            >
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
            {!!readCount && (
              <span className="doc-read-count">Read in {plural(readCount, 'chat')}</span>
            )}
            <Button variant="outline" size="sm" onClick={() => askAgent()}>
              <MessageSquare aria-hidden="true" />
              Ask agent
            </Button>
            {actions.planTasksDisabled ? (
              <Hint label={actions.planTasksDisabled}>
                {/* A disabled button gets no pointer events. The wrapper shows the reason. */}
                <span tabIndex={0} className="rounded-md">
                  <Button variant="outline" size="sm" disabled>
                    <ListChecks aria-hidden="true" />
                    Make tasks
                  </Button>
                </span>
              </Hint>
            ) : (
              <Button variant="outline" size="sm" onClick={makeTasks}>
                <ListChecks aria-hidden="true" />
                Make tasks
              </Button>
            )}
            <DropdownMenu>
              <Hint label="Page actions">
                <DropdownMenuTrigger asChild>
                  <MoreButton label="Page actions" />
                </DropdownMenuTrigger>
              </Hint>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={linkTask}>
                  <Link2 className="size-4" aria-hidden="true" />
                  Link a task
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSource((value) => !value)}>
                  <Code className="size-4" aria-hidden="true" />
                  {source ? 'Hide Markdown' : 'View Markdown'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={startMove}>
                  <FolderInput className="size-4" aria-hidden="true" />
                  Move page…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onSubpage}>
                  <FilePlus className="size-4" aria-hidden="true" />
                  Add subpage
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={requestDelete}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete page
                </DropdownMenuItem>
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
            <DialogDescription className="sr-only">
              Choose the parent page for this page.
            </DialogDescription>
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
      {tasks !== undefined && (
        <TaskPicker
          open={picking}
          onOpenChange={setPicking}
          tasks={tasks && tasks.filter((task) => !linked.has(task.id))}
          onPick={actions.onLinkTask}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            body.current?.querySelector<HTMLElement>('.doc-tasks [data-add]')?.focus();
          }}
        />
      )}
      <div className="wiki-page" ref={body}>
        <input
          className="doc-title"
          aria-label="Page title"
          placeholder="Untitled"
          maxLength={200}
          value={titleText}
          readOnly={readOnly}
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
        <div className="doc-tasks" role="group" aria-label="Linked tasks">
          <span className="doc-tasks-label">Tasks</span>
          {linkedTasks.map((task) => (
            <span key={task.id} className="doc-task-chip">
              <button type="button" title={task.title} onClick={() => openTask(groupId, task.id)}>
                <CircleDot size={12} aria-hidden="true" />
                <span className="truncate">{taskLabel(task)}</span>
                {task.status && <span className="doc-task-status">{task.status}</span>}
              </button>
              <button
                type="button"
                className="doc-task-unlink"
                aria-label={`Unlink ${taskLabel(task)}`}
                onClick={() => actions.onUnlinkTask(task)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="doc-task-chip" data-add="" onClick={linkTask}>
            <Plus size={12} aria-hidden="true" />
            Link task
          </button>
        </div>
        {source ? (
          <textarea
            className="wiki-source font-mono"
            aria-label="Markdown content"
            readOnly={readOnly}
            value={draft.markdown}
            onChange={(e) => update({ ...latest.current, markdown: e.target.value })}
            onBlur={() => void flush()}
          />
        ) : (
          <WikiEditor
            key={editorVersion}
            markdown={draft.markdown}
            readOnly={readOnly}
            onChange={(markdown) => update({ ...latest.current, markdown })}
            groupId={groupId}
            onOpenPage={(id) => {
              if (pages.some((p) => p.id === id)) onNavigate(id);
              else showToast({ message: 'This page is not in these docs.', tone: 'error' });
            }}
            tasks={tasks}
            api={api}
            onOpenTask={(itemId) => openTask(groupId, itemId)}
            actions={editorActions}
          />
        )}
      </div>
    </section>
  );
}

/** The menu of a page row. It opens on a right-click or with Shift+F10 on the row. */
function PageRowMenu({
  children,
  onSubpage,
  onMove,
  onDelete,
}: {
  children: ReactNode;
  onSubpage: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const item = (label: string, Icon: typeof Plus, run: () => void, destructive = false) => (
    <ContextMenu.Item
      className={cn(menuItemClass, destructive && menuDestructiveClass)}
      onSelect={run}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </ContextMenu.Item>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={menuCollisionPadding} className={menuContentClass}>
          {item('Add subpage', FilePlus, onSubpage)}
          {item('Move page…', FolderInput, onMove)}
          <ContextMenu.Separator className={menuSeparatorClass} />
          {item('Delete page', Trash2, onDelete, true)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** A request from the Knowledge tab to open a page. The serial repeats a request. */
export interface DocOpenRequest {
  docId: string;
  heading?: string;
  serial: number;
}

/**
 * The pages of the Knowledge tab: the page tree in the rail and the page editor. The rail can
 * hold more groups (`railTop`, `railBottom`). With `pane`, the right side shows that instead of
 * the editor.
 */
export function ProjectDocsPanel({
  api,
  group,
  initialPageId,
  initialHeading,
  request,
  railTop,
  railBottom,
  railOpen,
  pane,
  switcher,
  onPageOpen,
  readCounts,
}: {
  api: API;
  group: ProjectGroup;
  /** Opens this page, for example from a search result. */
  initialPageId?: string;
  /** Scrolls the opened page to the heading with this text. */
  initialHeading?: string;
  request?: DocOpenRequest;
  /** Rail content above the pages, for example the search box. */
  railTop?: ReactNode;
  /** Rail groups under the pages. */
  railBottom?: ReactNode;
  /** In a narrow window, the rail shows over the content while this is true. */
  railOpen?: boolean;
  /** Shows this on the right instead of the page editor. */
  pane?: ReactNode;
  /** The Knowledge switcher for a narrow window. It shows in the document bar. */
  switcher?: ReactNode;
  /** Called when the user opens a page from the rail. */
  onPageOpen?: () => void;
  /** The number of chats that read each page. */
  readCounts?: Record<string, number>;
}) {
  const [selected, setSelected] = useState('');
  const [heading, setHeading] = useState<{ text: string; serial: number } | undefined>(
    initialHeading ? { text: initialHeading, serial: 1 } : undefined,
  );
  useEffect(() => {
    if (initialHeading)
      setHeading((current) => ({ text: initialHeading, serial: (current?.serial ?? 0) + 1 }));
  }, [initialHeading]);
  useEffect(() => {
    if (!request) return;
    setSelected(request.docId);
    if (request.heading)
      setHeading((current) => ({ text: request.heading!, serial: (current?.serial ?? 0) + 1 }));
  }, [request?.serial]);
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
  // The title bar shows the open page. Tell it the page and its current title, or that no page
  // shows.
  const selectedTitle = pages.find((p) => p.id === selected)?.title;
  useEffect(() => {
    if (pane || !selected || selectedTitle === undefined) {
      if (pane) window.dispatchEvent(new CustomEvent('kalkidan-doc-selected', { detail: {} }));
      return;
    }
    window.dispatchEvent(
      new CustomEvent('kalkidan-doc-selected', {
        detail: { groupId: group.id, docId: selected, title: selectedTitle || 'Untitled' },
      }),
    );
  }, [group.id, selected, selectedTitle, !!pane]);
  const [treeCommand, setTreeCommand] = useState<TreeCommand>();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const loading = ['idle', 'loading'].includes(metadata.state.status);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletedPages, setDeletedPages] = useState<DeletedProjectDoc[] | null>(null);
  const pageLoading = ['idle', 'loading'].includes(content.state.status) && !!selected;
  // While a title is edited, the list sorts by the titles from before the edit.
  const [frozenTitles, setFrozenTitles] = useState<Map<string, string> | null>(null);
  // After New page, focus goes to the title of the new page, not back to the page list.
  const createdPage = useRef<string | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const [planning, setPlanning] = useState(false);
  // An action that waits for a board: it continues when the board connects.
  const [afterConnect, setAfterConnect] = useState<'plan' | 'link' | null>(null);
  const connection = trackerConnection(group);
  const provider = connection?.provider || 'github';
  const client = useMemo(() => trackerClient(api, provider), [api, provider]);
  const board = useProjectBoard(api, client, provider, group.id, connection?.project);
  const writable = board.state.value?.writable;
  const planReason = connection ? planTasksReason(true, writable) : undefined;
  const boardTasks: TrackerItem[] | null | undefined = !connection
    ? undefined
    : board.state.value
      ? board.state.value.items
      : board.state.status === 'error'
        ? []
        : null;
  const [taskLinks, setTaskLinks] = useState<Record<string, string[]>>();
  const [linkSerial, setLinkSerial] = useState(0);
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
  }, [api, group.id, !!connection, selected, linkSerial]);
  const [linking, setLinking] = useState(false);
  // Continue the action after Connect board.
  useEffect(() => {
    if (!connection || !afterConnect) return;
    if (afterConnect === 'plan') setPlanning(true);
    else setLinking(true);
    setAfterConnect(null);
  }, [!!connection, afterConnect]);
  function askAgent(doc: ProjectDoc, text?: string) {
    const title = doc.title || 'Untitled';
    const quote = text
      ?.split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    window.dispatchEvent(
      new CustomEvent('kalkidan-new-session', {
        detail: {
          groupId: group.id,
          docIds: [doc.id],
          prompt: quote ? `About this part of "${title}":\n\n${quote}\n\n` : '',
        },
      }),
    );
  }
  async function setLink(task: TrackerItem, linked: boolean) {
    if (!page || typeof api.setTaskDocLinks !== 'function') return;
    try {
      const links = (await api.taskDocLinks?.(group.id)) || {};
      const current = links[task.id] || [];
      const next = linked
        ? [...new Set([...current, page.id])]
        : current.filter((id) => id !== page.id);
      await api.setTaskDocLinks(group.id, task.id, next);
      setTaskLinks({ ...links, [task.id]: next });
      setLinkSerial((value) => value + 1);
    } catch (failure) {
      showToast({ message: errorMessage(failure), tone: 'error' });
    }
  }
  async function makeTask(text: string) {
    if (!connection) {
      connectBoard(group.id);
      return;
    }
    if (planReason) {
      showToast({ message: planReason, tone: 'error' });
      return;
    }
    const [first, ...rest] = text.split('\n');
    const title = first.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').trim();
    try {
      const id = await api.trackerDraft(group.id, title.slice(0, 256), rest.join('\n').trim());
      if (id && page && typeof api.setTaskDocLinks === 'function') {
        const links = (await api.taskDocLinks?.(group.id)) || {};
        await api.setTaskDocLinks(group.id, id, [...new Set([...(links[id] || []), page.id])]);
      }
      void board.refresh().catch(() => undefined);
      setLinkSerial((value) => value + 1);
      showToast({
        message: `Task “${title.slice(0, 60)}” added.`,
        actions: id ? [{ label: 'Open', onClick: () => openTask(group.id, id) }] : undefined,
      });
    } catch (failure) {
      showToast({ message: errorMessage(failure), tone: 'error' });
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
      setSelected(initialPage(pages, request?.docId || initialPageId || readSelection(group.id)));
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
  function open(id: string) {
    setSelected(id);
    onPageOpen?.();
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
      open(doc.id);
    });
  }
  // Focus the title of the new page when its editor shows. Typing replaces "Untitled".
  const openPageId = page && page.id === selected && !pane ? page.id : '';
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
  function command(id: string, kind: TreeCommand['kind']) {
    open(id);
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
  /** Moves page `id` before or after `targetId`, and writes the new order of its siblings. */
  function place(id: string, targetId: string, position: 'before' | 'after') {
    const next = placedSiblings(pages, id, targetId, position);
    if (!next) return;
    const moved = pages.find((p) => p.id === id);
    void action(async () => {
      // Write the position of each sibling whose position changed. The open page saves
      // through its editor, so that the editor keeps the current revision.
      for (const [order, sibling] of next.entries()) {
        const parentChanged = sibling.id === id && moved?.parentId !== sibling.parentId;
        if (sibling.order === order && !parentChanged) continue;
        if (sibling.id === page?.id)
          setTreeCommand((current) => ({
            id: sibling.id,
            kind: 'order',
            order,
            parentId: parentChanged ? sibling.parentId : undefined,
            serial: (current?.serial ?? 0) + 1,
          }));
        else {
          const full = await api.docsRead(group.id, sibling.id);
          await api.docsSave(group.id, { ...full, order, parentId: sibling.parentId });
        }
        setPages((current) =>
          current.map((p) =>
            p.id === sibling.id ? { ...p, order, parentId: sibling.parentId } : p,
          ),
        );
      }
    });
  }
  const [drag, setDrag] = useState<{
    id: string;
    over?: string;
    position?: 'before' | 'after';
  } | null>(null);
  function dragOver(event: DragEvent<HTMLElement>, targetId: string) {
    if (!drag || drag.id === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
    if (drag.over !== targetId || drag.position !== position)
      setDrag({ ...drag, over: targetId, position });
  }
  const hasSubpages = !!page && !!children.get(page.id)?.length;
  const hasPages = pages.length > 0;
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
  function tree(parentId: string | null, visited = new Set<string>()): ReactNode {
    const siblings = children.get(parentId) || [];
    return siblings.map((p, index) => {
      if (visited.has(p.id)) return null;
      const next = new Set(visited).add(p.id);
      const hasChildren = !!children.get(p.id)?.length;
      const current = !pane && selected === p.id;
      return (
        <li key={p.id}>
          <PageRowMenu
            onSubpage={() => newPage(p.id)}
            onMove={() => command(p.id, 'move')}
            onDelete={() => command(p.id, 'delete')}
          >
            <div
              className="wiki-tree-row row-focus"
              data-selected={current}
              data-drop={drag?.over === p.id ? drag.position : undefined}
              draggable={!busy}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', p.title);
                setDrag({ id: p.id });
              }}
              onDragOver={(event) => dragOver(event, p.id)}
              onDragLeave={() => drag?.over === p.id && setDrag({ id: drag.id })}
              onDrop={(event) => {
                event.preventDefault();
                if (drag?.over === p.id && drag.position) place(drag.id, p.id, drag.position);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="wiki-tree-icon"
                  aria-label={`Toggle ${p.title} subpages`}
                  aria-expanded={!collapsed[p.id]}
                  onClick={() => setCollapsed((c) => ({ ...c, [p.id]: !c[p.id] }))}
                >
                  <FileText size={16} className="wiki-tree-file" aria-hidden="true" />
                  {collapsed[p.id] ? (
                    <ChevronRight size={14} className="wiki-tree-chevron" aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} className="wiki-tree-chevron" aria-hidden="true" />
                  )}
                </button>
              ) : (
                <span className="wiki-tree-icon" aria-hidden="true">
                  <FileText size={16} />
                </span>
              )}
              <button
                type="button"
                className="doc-tree-page"
                title={p.title}
                aria-current={current ? 'page' : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                onClick={() => open(p.id)}
                onKeyDown={(event) => {
                  // Alt+Arrow keys move the page up or down in the list.
                  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  const up = event.key === 'ArrowUp';
                  const target = siblings[index + (up ? -1 : 1)];
                  if (target) place(p.id, target.id, up ? 'before' : 'after');
                }}
              >
                {p.title || 'Untitled'}
              </button>
            </div>
          </PageRowMenu>
          {hasChildren && !collapsed[p.id] && (
            <ul className="wiki-tree-children">{tree(p.id, next)}</ul>
          )}
        </li>
      );
    });
  }
  const pageActions: PageActions = {
    onAskAgent: askAgent,
    onPlanTasks: () => {
      if (connection) setPlanning(true);
      else {
        setAfterConnect('plan');
        connectBoard(group.id);
      }
    },
    planTasksDisabled: planReason,
    onConnectBoard: connection
      ? undefined
      : () => {
          setAfterConnect('link');
          connectBoard(group.id);
        },
    onLinkTask: (task) => void setLink(task, true),
    onUnlinkTask: (task) => void setLink(task, false),
    onMakeTask: (text) => void makeTask(text),
  };
  return (
    <section className="project-docs knowledge" aria-label="Knowledge" data-rail-open={railOpen}>
      <aside className="knowledge-rail" aria-label="Knowledge sections">
        {railTop}
        <div className="knowledge-rail-scroll">
          <KnowledgeRailGroup
            label="Pages"
            actions={
              <>
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <MoreButton size="xs" label="Pages menu" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={() =>
                        void action(async () => {
                          setDeletedPages(await api.docsTrash(group.id));
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Deleted pages
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          >
            {hasPages ? (
              <nav aria-label="Document structure">
                <ul className="wiki-page-tree">{tree(null)}</ul>
              </nav>
            ) : (
              <button
                type="button"
                className="wiki-tree-row knowledge-rail-muted"
                disabled={busy || loading}
                onClick={() => newPage(null)}
              >
                <Plus size={16} aria-hidden="true" />
                New page
              </button>
            )}
          </KnowledgeRailGroup>
          {railBottom}
        </div>
      </aside>
      {error && !pane && (
        <Alert variant="destructive" size="sm" className="knowledge-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {pane ? (
        <div className="knowledge-pane">{pane}</div>
      ) : page && page.id === selected ? (
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
            onTitleEditing={(editing) =>
              setFrozenTitles(editing ? new Map(pages.map((doc) => [doc.id, doc.title])) : null)
            }
            initial={page}
            pages={pages}
            onSaved={saved}
            actions={pageActions}
            switcher={switcher}
            tasks={boardTasks}
            linkedTasks={tasksForPage(page.id, taskLinks, boardTasks)}
            readCount={readCounts?.[page.id]}
            heading={heading}
            onDelete={() => {
              setError('');
              setDeleting(true);
            }}
          />
        </div>
      ) : (
        <div className="knowledge-pane">
          {switcher && <div className="knowledge-pane-bar">{switcher}</div>}
          <EmptyState
            icon={<BookOpen />}
            title={
              loading || pageLoading
                ? 'Loading pages…'
                : pages.length
                  ? 'No page open'
                  : 'No pages yet'
            }
            action={
              !loading &&
              !pageLoading &&
              !pages.length && (
                <Button variant="outline" disabled={busy} onClick={() => newPage(null)}>
                  <Plus size={16} /> New page
                </Button>
              )
            }
          />
        </div>
      )}
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
      {boardTasks !== undefined && (
        <TaskPicker
          open={linking}
          onOpenChange={setLinking}
          tasks={boardTasks}
          onPick={(task) => void setLink(task, true)}
          onCloseAutoFocus={(event) => event.preventDefault()}
        />
      )}
      <Dialog
        open={deletedPages !== null}
        onOpenChange={(open) => !open && !busy && setDeletedPages(null)}
      >
        <DialogContent layout="scroll">
          <DialogHeader>
            <DialogTitle>Deleted pages</DialogTitle>
            <DialogDescription className="sr-only">
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
                          open(doc.id);
                        })
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={<Trash2 />}>
                No deleted pages.
              </EmptyState>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </section>
  );
}
