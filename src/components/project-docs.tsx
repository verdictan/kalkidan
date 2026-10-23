import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { ContextMenu } from 'radix-ui';
import { DocSaveMachine } from '../domain/doc-save';
import {
  WikiEditor,
  TaskPicker,
  repositoryName,
  taskHref,
  type TaskRowControl,
  type WikiEditorActions,
} from './wiki-editor';
import { useProjectResource, setProjectResource } from '../hooks/use-project-resource';
import { Code, FilePlus, FolderInput, Plus, Trash2 } from 'lucide-react';
import type { API, Project, ProjectGroup, TrackerItem } from '../types';
import type { DocsIssuePlan } from '../domain/docs-plan';
import { identityVar } from '../domain/identity';
import { useIdentityColors } from '../hooks/use-identity';
import { trackerConnection } from '../domain/tracker';
import { revertIssuesToDrafts, trackerClient } from '../lib/tracker-client';
import { useProjectBoard } from '../hooks/use-project-board';
import { mainRepository } from './docs-to-issues';
import { openConnectBoard } from './tracker-project-picker';
import type { DeletedProjectDoc, ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import { hasPrimaryModifier, isMac, plural, shortcutLabel } from '../lib/platform';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { showToast } from './ui/toast';
import { IdentityMark } from './ui/identity-mark';
import { Choice } from './choice';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  menuCollisionPadding,
  menuContentClass,
  menuDestructiveClass,
  menuItemClass,
  menuSeparatorClass,
} from './ui/menu-styles';
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
import { fullTime, relativeTime } from '../lib/relative-time';

type TreeCommand = {
  id: string;
  kind: 'move' | 'delete' | 'order' | 'source';
  /** The new sibling position for kind 'order'. */
  order?: number;
  /** The new parent for kind 'order', when the page moves to other siblings. */
  parentId?: string | null;
  serial: number;
};
/**
 * The serial of the last tree command. It only goes up: a handled command clears the command,
 * so a serial from the cleared command would repeat a serial that the editor already handled.
 */
let treeCommandSerial = 0;

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

/** Alerts in the editor: under the document bar, at the width of the text column. */
/** New page: ⌥⌘N on macOS, Ctrl+Alt+N on Windows and Linux. */
const newPageKeys = isMac ? 'Meta+Alt+N' : 'Control+Alt+N';
const docAlertClass = 'mt-3 mx-[var(--pane-inset)] max-w-[var(--reading-width)]';

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

/** When a page changed, after "Edited": "just now", "2h ago", or a day or date. */
export function editedText(value: string | number, now = Date.now()) {
  const time = relativeTime(value, now);
  if (time === 'now') return 'just now';
  return /^\d+[mh]$/.test(time) ? `${time} ago` : time;
}

/** The page and task actions that the editor gets from the docs page. */
interface PageActions {
  /** Starts a new chat with this page attached. With text, the chat asks about that text. */
  onAskAgent: (doc: ProjectDoc, text?: string) => void;
  /** "Make N tasks" on a checklist: makes the tasks at once, with Change and Undo in a toast. */
  onMakeTasks: (
    doc: ProjectDoc,
    titles: string[],
    rows: TaskRowControl,
  ) => Promise<TrackerItem[] | void>;
  /** Why "Make tasks" cannot run, for example on a read-only board. */
  planTasksDisabled?: string;
  /** Opens Connect board. Undefined when the project has a board. */
  onConnectBoard?: () => void;
  onLinkTask: (task: TrackerItem) => void;
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
  readCount,
  repoColor,
}: {
  actions: PageActions;
  /** The Knowledge switcher. It shows above the title in a narrow window. */
  switcher?: ReactNode;
  /** The board tasks for "/", "#" and the task rows. Undefined: no board. Null: it loads. */
  tasks?: TrackerItem[] | null;
  /** The number of sessions that read this page. */
  readCount?: number;
  /** The color of a repository ring, from the identity palette. */
  repoColor?: (repository: string) => string | undefined;
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
  // Each command runs once, also when React runs the effect twice (Strict Mode). Two runs of
  // 'delete' showed two toasts.
  const handledCommand = useRef(0);
  useEffect(() => {
    if (treeCommand?.id !== initial.id || handledCommand.current === treeCommand.serial) return;
    handledCommand.current = treeCommand.serial;
    if (treeCommand.kind === 'move') startMove();
    else if (treeCommand.kind === 'delete') requestDelete();
    else if (treeCommand.kind === 'source') setSource((value) => !value);
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
  // A save shows only when it is slow (after 1 second) or when it fails. The time of the last
  // change shows in the meta line: from the page file, then from each save.
  const [slowSave, setSlowSave] = useState(false);
  const [editedAt, setEditedAt] = useState(() =>
    initial.updatedAt ? new Date(initial.updatedAt).toISOString() : undefined,
  );
  const saving = ['dirty', 'saving'].includes(saveState.status);
  useEffect(() => {
    if (!saving) {
      setSlowSave(false);
      return;
    }
    const slow = setTimeout(() => setSlowSave(true), 1000);
    return () => clearTimeout(slow);
  }, [saving]);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (saveState.status === 'clean' && wasSaving.current) setEditedAt(new Date().toISOString());
    wasSaving.current = saving;
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
    saveState.status === 'clean' ? '' : saving ? (slowSave ? 'Saving…' : '') : 'Not saved';
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
  const askAgent = (text?: string) =>
    void flush().then(() => actions.onAskAgent(latest.current, text));
  const meta = [
    editedAt ? `Edited ${editedText(editedAt)}` : '',
    readCount ? `Read in ${plural(readCount, 'session')}` : '',
  ].filter(Boolean);
  const editorActions: WikiEditorActions = {
    onLinkTask: actions.onLinkTask,
    onConnectBoard: actions.onConnectBoard,
    onMakeTask: actions.onMakeTask,
    onAskSelection: (text) => askAgent(text),
    onMakeTasks: actions.planTasksDisabled
      ? undefined
      : async (titles, rows) => {
          await flush();
          return actions.onMakeTasks(latest.current, titles, rows);
        },
  };
  return (
    <section className="doc-editor" aria-label="Document editor">
      {switcher && <div className="knowledge-switcher-row">{switcher}</div>}
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
        {/* When the page changed, how many sessions read it, and a slow or failed save. */}
        <p className="doc-meta">
          {meta.map((text) => (
            <span key={text}>{text}</span>
          ))}
          {/* Do not announce each save. Announce only a failed save. */}
          {status && (
            <span role="status" aria-live="off" className="doc-save-state">
              {status}
            </span>
          )}
          {saveState.status === 'save-error' && (
            <Button variant="link" className="h-auto p-0 text-xs" onClick={retry}>
              Retry
            </Button>
          )}
        </p>
        {status === 'Not saved' && (
          <span role="alert" className="sr-only">
            The page is not saved.
          </span>
        )}
        {source ? (
          <Textarea
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
            repoColor={repoColor}
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
  onSource,
  onDelete,
}: {
  children: ReactNode;
  onSubpage: () => void;
  onMove: () => void;
  /** Shows or hides the Markdown text of the page. */
  onSource: () => void;
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
          {item('View Markdown', Code, onSource)}
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

/** The window event that opens "Recently deleted" for a project. detail: { groupId }. */
export const recentlyDeletedEvent = 'kalkidan-knowledge-deleted';
/** The window event that makes a new page in a project. detail: { groupId }. */
export const newPageEvent = 'kalkidan-knowledge-new-page';

const repositoryKey = (groupId: string) => 'kalkidan-make-tasks-repository:' + groupId;
function readRepository(groupId: string) {
  try {
    return localStorage.getItem(repositoryKey(groupId)) || '';
  } catch {
    return '';
  }
}
function writeRepository(groupId: string, value: string) {
  try {
    localStorage.setItem(repositoryKey(groupId), value);
  } catch {
    // Storage can be unavailable. The next "Make tasks" then uses the main repository.
  }
}

/** The Markdown of a page with the links to these tasks as plain text again (Undo). */
export function withoutTaskLinks(markdown: string, hrefs: string[]) {
  let result = markdown;
  for (const href of hrefs) {
    const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\[([^\\]\\n]*)\\]\\(<?${escaped}>?\\)`, 'g'), '$1');
  }
  return result;
}

/**
 * The pages that show in the rail while Find has text: each page with matches and the parent
 * pages above it. Null when Find is empty.
 */
export function visiblePages(
  pages: ProjectDocMetadata[],
  matches: Record<string, number> | undefined,
) {
  if (!matches) return null;
  const visible = new Set<string>();
  for (const id of Object.keys(matches)) {
    if (!pages.some((page) => page.id === id)) continue;
    visible.add(id);
    for (const parent of pageAncestors(pages, id)) visible.add(parent.id);
  }
  return visible;
}

/**
 * The pages of the Knowledge tab: one rail (Find, the `railLead` rows, the page tree and New
 * page) and the page editor. With `pane`, the right side shows that instead of the editor.
 */
export function ProjectDocsPanel({
  api,
  group,
  repos = [],
  initialPageId,
  initialHeading,
  request,
  find,
  matches,
  railLead,
  railOpen,
  pane,
  switcher,
  onPageOpen,
  readCounts,
}: {
  api: API;
  group: ProjectGroup;
  /** The code folders of the project. They give the repository colors. */
  repos?: Project[];
  /** Opens this page, for example from a search result. */
  initialPageId?: string;
  /** Scrolls the opened page to the heading with this text. */
  initialHeading?: string;
  request?: DocOpenRequest;
  /** The Find field at the top of the rail. */
  find?: ReactNode;
  /** While Find has text: the number of matches of each page. Other pages do not show. */
  matches?: Record<string, number>;
  /** Rail rows above the pages, for example Memory. */
  railLead?: ReactNode;
  /** In a narrow window, the rail shows over the content while this is true. */
  railOpen?: boolean;
  /** Shows this on the right instead of the page editor. */
  pane?: ReactNode;
  /** The Knowledge switcher for a narrow window. It shows above the title. */
  switcher?: ReactNode;
  /** Called when the user opens a page from the rail. */
  onPageOpen?: () => void;
  /** The number of sessions that read each page. */
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
  const [error, setError] = useState('');
  const loading = ['idle', 'loading'].includes(metadata.state.status);
  const [busy, setBusy] = useState(false);
  const [deletedPages, setDeletedPages] = useState<DeletedProjectDoc[] | null>(null);
  const pageLoading = ['idle', 'loading'].includes(content.state.status) && !!selected;
  // While a title is edited, the list sorts by the titles from before the edit.
  const [frozenTitles, setFrozenTitles] = useState<Map<string, string> | null>(null);
  // After New page, focus goes to the title of the new page, not back to the page list.
  const createdPage = useRef<string | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  // An action that waits for a board: it continues when the board connects.
  const [afterConnect, setAfterConnect] = useState<'link' | 'task' | 'make' | null>(null);
  // The selected text of "Make task" while the board connects.
  const pendingTask = useRef('');
  // The checklist of "Make N tasks" while the board connects.
  const pendingMake = useRef<{ doc: ProjectDoc; titles: string[]; rows: TaskRowControl }>(
    undefined,
  );
  const connection = trackerConnection(group);
  const provider = connection?.provider || 'github';
  const client = useMemo(() => trackerClient(api, provider), [api, provider]);
  const board = useProjectBoard(api, client, provider, group.id, connection?.project);
  const writable = board.state.value?.writable;
  const planReason = connection ? planTasksReason(true, writable) : undefined;
  // Tasks that "Make N tasks" made. They show as task rows before the board loads again.
  const [madeTasks, setMadeTasks] = useState<TrackerItem[]>([]);
  const boardTasks: TrackerItem[] | null | undefined = !connection
    ? undefined
    : board.state.value
      ? [
          ...board.state.value.items,
          ...madeTasks.filter((made) => !board.state.value!.items.some((t) => t.id === made.id)),
        ]
      : board.state.status === 'error'
        ? madeTasks
        : null;
  const repoItems = useMemo(
    () => repos.map((repo) => ({ key: repo.name, name: repo.name })),
    [repos.map((repo) => repo.name).join('\n')],
  );
  const repoColors = useIdentityColors('repo', repoItems);
  const repoColor = (repository: string) => {
    const color = repoColors.get(repositoryName(repository));
    return color ? identityVar(color) : undefined;
  };
  const [linking, setLinking] = useState(false);
  // The repository choice of "Change" in the toast. It resolves with the chosen repository.
  const [repositoryChoice, setRepositoryChoice] = useState<{
    value: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  // Continue the action after Connect board.
  useEffect(() => {
    if (!afterConnect || !connection) return;
    const make = pendingMake.current;
    if (afterConnect === 'link') setLinking(true);
    else if (afterConnect === 'make' && make)
      void makeTasks(make.doc, make.titles, make.rows).then(
        (created) => created && make.rows.apply(make.titles, created),
      );
    else if (pendingTask.current) void makeTask(pendingTask.current);
    pendingTask.current = '';
    pendingMake.current = undefined;
    setAfterConnect(null);
  }, [!!connection, afterConnect]);
  /** Opens Connect board over the page. The action continues when the board connects. */
  function connectThen(next: 'link' | 'task' | 'make') {
    openConnectBoard({ groupId: group.id, onConnected: () => setAfterConnect(next) });
  }
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
    } catch (failure) {
      showToast({ message: errorMessage(failure), tone: 'error' });
    }
  }
  /** Adds the page to the related pages of each task. */
  async function linkPageTo(docId: string, ids: string[]) {
    if (typeof api.setTaskDocLinks !== 'function' || !ids.length) return;
    const links = (await api.taskDocLinks?.(group.id)) || {};
    for (const id of ids)
      await api.setTaskDocLinks(group.id, id, [...new Set([...(links[id] || []), docId])]);
  }
  async function makeTask(text: string) {
    if (!connection) {
      pendingTask.current = text;
      connectThen('task');
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
      if (id && page) await linkPageTo(page.id, [id]);
      void board.refresh().catch(() => undefined);
      showToast({
        message: `Task “${title.slice(0, 60)}” added.`,
        actions: id ? [{ label: 'Open', onClick: () => openTask(group.id, id) }] : undefined,
      });
    } catch (failure) {
      showToast({ message: errorMessage(failure), tone: 'error' });
    }
  }
  /** Asks for a repository for new tasks. Resolves with null when the user cancels. */
  function chooseRepository(value: string) {
    return new Promise<string | null>((resolve) => setRepositoryChoice({ value, resolve }));
  }
  /** The repositories of the board tasks, for the repository choice. */
  const boardRepositories = [
    ...new Set(
      (board.state.value?.items || []).flatMap((item) =>
        item.repository ? [item.repository] : [],
      ),
    ),
  ].sort();
  /** Adds one GitHub issue for each title to the board, in a repository. */
  async function createTasks(doc: ProjectDoc, titles: string[], repository: string) {
    const plan: DocsIssuePlan = {
      id: crypto.randomUUID(),
      repository,
      entries: titles.map((title) => ({
        title: title.slice(0, 256),
        // Each task names its source page, so an agent can read it.
        body: `Source document: ${doc.title || 'Untitled'} (${doc.id}, revision ${doc.revision}).`,
      })),
    };
    const result = await api.trackerDocsPlan(group.id, plan);
    const ids = titles.map(
      (_, index) =>
        result.rows.find((row) => row.index === index && row.state === 'complete')?.itemId,
    );
    const next = await board.refresh().catch(() => undefined);
    const created = ids.map(
      (id, index): TrackerItem | undefined =>
        next?.items.find((item) => item.id === id) ||
        (id ? { id, title: titles[index], body: '', repository, status: 'Todo' } : undefined),
    );
    const made = created.filter((task): task is TrackerItem => !!task);
    setMadeTasks((current) => [
      ...current.filter((t) => !made.some((m) => m.id === t.id)),
      ...made,
    ]);
    await linkPageTo(
      doc.id,
      made.map((task) => task.id),
    ).catch(() => undefined);
    window.dispatchEvent(
      new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
    );
    writeRepository(group.id, repository);
    return created;
  }
  /** Removes the tasks from the board and turns their rows back into open items. */
  async function removeTasks(doc: ProjectDoc, tasks: TrackerItem[], rows: TaskRowControl) {
    await Promise.all(
      tasks.map((task) =>
        api.trackerItemAction(group.id, task.id, { kind: 'remove' }).catch(() => undefined),
      ),
    );
    await restoreRows(doc, tasks, rows);
  }
  /**
   * Undo of "Make N tasks": each new issue closes on GitHub as not planned, and a draft with the
   * same title and description takes its place on the board. The task rows on the page turn back
   * into open items. An issue that does not change keeps its row.
   */
  async function undoTasks(doc: ProjectDoc, tasks: TrackerItem[], rows: TaskRowControl) {
    const items = board.state.value?.items || [];
    const results = await revertIssuesToDrafts(
      api,
      group.id,
      tasks.map((task) => ({
        itemId: task.id,
        title: task.title,
        body: task.body || '',
        statusId: items.find((item) => item.id === task.id)?.statusId || task.statusId,
      })),
    );
    const drafts = results.flatMap((result) => (result.draftId ? [result.draftId] : []));
    await linkPageTo(doc.id, drafts).catch(() => undefined);
    const reverted = tasks.filter((task) =>
      results.some((result) => result.itemId === task.id && result.draftId),
    );
    if (reverted.length) await restoreRows(doc, reverted, rows);
    const failed = results.filter((result) => result.error);
    if (failed.length)
      showToast({
        message:
          `${plural(failed.length, 'task')} did not change back to a draft. ` +
          `${failed[0].error}`,
        tone: 'error',
      });
  }
  /** Turns the rows of the tasks back into open items and reloads the board. */
  async function restoreRows(doc: ProjectDoc, tasks: TrackerItem[], rows: TaskRowControl) {
    setMadeTasks((current) => current.filter((t) => !tasks.some((task) => task.id === t.id)));
    if (!rows.revert(tasks)) {
      // The page is not open now: change its Markdown file.
      const saved = await api.docsRead(group.id, doc.id);
      const markdown = withoutTaskLinks(saved.markdown, tasks.map(taskHref));
      if (markdown !== saved.markdown) {
        const next = await api.docsSave(group.id, { ...saved, markdown });
        setProjectResource(api, group, 'docs-page', next, next.id);
      }
    }
    void board.refresh().catch(() => undefined);
    window.dispatchEvent(
      new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
    );
  }
  /**
   * "Make N tasks": makes the tasks at once in the last repository. The toast names the
   * repository and has Change and Undo.
   */
  async function makeTasks(doc: ProjectDoc, titles: string[], rows: TaskRowControl) {
    if (!connection) {
      // The tasks are made after the board connects. The rows then change through `rows`.
      pendingMake.current = { doc, titles, rows };
      connectThen('make');
      return;
    }
    if (planReason) {
      showToast({ message: planReason, tone: 'error' });
      return;
    }
    const known = board.state.value || (await board.refresh().catch(() => undefined));
    let repository =
      readRepository(group.id) || mainRepository((known?.items || []).map((i) => i.repository));
    if (!repository) repository = (await chooseRepository('')) || '';
    if (!repository) return;
    try {
      const created = await createTasks(doc, titles, repository);
      const made = created.filter((task): task is TrackerItem => !!task);
      if (!made.length) {
        showToast({ message: 'Kalkidan could not make the tasks.', tone: 'error' });
        return;
      }
      announce(doc, titles, made, repository, rows);
      return created as TrackerItem[];
    } catch (failure) {
      showToast({ message: errorMessage(failure), tone: 'error' });
    }
  }
  /** The toast after "Make N tasks": "3 tasks in atlas-web", Change and Undo. */
  function announce(
    doc: ProjectDoc,
    titles: string[],
    made: TrackerItem[],
    repository: string,
    rows: TaskRowControl,
  ) {
    const name = repositoryName(repository);
    const color = repoColors.get(name);
    showToast({
      message: `${plural(made.length, 'task')} in ${name}`,
      // "3 tasks in ○ atlas-web": the repo mark before the repo name, as in the tree.
      content: (
        <span className="inline-flex items-center gap-1.5">
          {`${plural(made.length, 'task')} in `}
          {color && <IdentityMark kind="repo" color={color} slot={false} />}{' '}
          <b className="font-semibold">{name}</b>
        </span>
      ),
      tone: 'success',
      closable: false,
      actions: [
        {
          label: 'Change',
          onClick: () =>
            void (async () => {
              const next = await chooseRepository(repository);
              if (!next || next === repository) return;
              await removeTasks(doc, made, rows);
              try {
                const created = await createTasks(doc, titles, next);
                const again = created.filter((task): task is TrackerItem => !!task);
                if (!again.length) return;
                rows.apply(
                  titles.filter((_, index) => !!created[index]),
                  again,
                );
                announce(doc, titles, again, next, rows);
              } catch (failure) {
                showToast({ message: errorMessage(failure), tone: 'error' });
              }
            })(),
        },
        { label: 'Undo', onClick: () => void undoTasks(doc, made, rows) },
      ],
    });
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
      createdPage.current = doc.id;
      open(doc.id);
    });
  }
  const newPageRef = useRef(newPage);
  newPageRef.current = newPage;
  // ⌥⌘N makes a new page while the Knowledge tab shows. ⌘⇧N is New project in the app menu.
  // ⌘K and the menu send an event. Option changes the character of N, so the key code is read.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !hasPrimaryModifier(event) ||
        !event.altKey ||
        event.shiftKey ||
        event.code !== 'KeyN' ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      newPageRef.current(null);
    };
    const requested = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string }>).detail;
      if (!detail?.groupId || detail.groupId === group.id) newPageRef.current(null);
    };
    const deleted = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string }>).detail;
      if (detail?.groupId && detail.groupId !== group.id) return;
      void action(async () => setDeletedPages(await api.docsTrash(group.id)));
    };
    window.addEventListener('keydown', key);
    window.addEventListener(newPageEvent, requested);
    window.addEventListener(recentlyDeletedEvent, deleted);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener(newPageEvent, requested);
      window.removeEventListener(recentlyDeletedEvent, deleted);
    };
  }, [group.id]);
  // Focus the title of the new page when its editor shows. Typing replaces "Untitled".
  const openPageId = page && page.id === selected && !pane ? page.id : '';
  useEffect(() => {
    if (!openPageId || createdPage.current !== openPageId) return;
    createdPage.current = null;
    const frame = requestAnimationFrame(() => {
      const input = workspace.current?.querySelector<HTMLInputElement>('.doc-title');
      input?.focus({ preventScroll: true });
      input?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [openPageId]);
  // A page opens at its top.
  useEffect(() => {
    const element = workspace.current;
    if (element) element.scrollTop = 0;
  }, [openPageId]);
  /** Puts a deleted page back and opens it. */
  async function restore(trashId: string) {
    const doc = await api.docsRestore(group.id, trashId);
    setProjectResource(api, group, 'docs-page', doc, doc.id);
    setPages((current) => [
      ...current.filter((p) => p.id !== doc.id),
      { id: doc.id, title: doc.title, parentId: doc.parentId, order: doc.order },
    ]);
    open(doc.id);
    return doc;
  }
  // The pages that a delete runs for. A second request for the same page does nothing.
  const deleting = useRef(new Set<string>());
  /**
   * Deletes a page at once, with no dialog. The toast can undo it, as for a removed fact.
   * "Recently deleted" in ⌘K can restore it later.
   */
  function deletePage(doc: ProjectDoc) {
    if (deleting.current.has(doc.id)) return;
    deleting.current.add(doc.id);
    return action(async () => {
      await api.docsDelete(group.id, doc.id, doc.revision);
      setPages((p) => p.filter((d) => d.id !== doc.id));
      setSelected(pageAfterDelete(pages, doc.id));
      showToast({
        message: `“${doc.title || 'Untitled'}” deleted.`,
        actions: [
          {
            label: 'Undo',
            onClick: () =>
              void action(async () => {
                const trash = await api.docsTrash(group.id);
                const item = trash
                  .filter((entry) => entry.id === doc.id)
                  .sort((a, b) => b.deletedAt - a.deletedAt)[0];
                if (item) await restore(item.trashId);
              }),
          },
        ],
      });
    }).finally(() => deleting.current.delete(doc.id));
  }
  function command(id: string, kind: TreeCommand['kind']) {
    open(id);
    setTreeCommand({ id, kind, serial: ++treeCommandSerial });
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
          setTreeCommand({
            id: sibling.id,
            kind: 'order',
            order,
            parentId: parentChanged ? sibling.parentId : undefined,
            serial: ++treeCommandSerial,
          });
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
  const visible = useMemo(() => visiblePages(pages, matches), [pages, matches]);
  // The rail is one list: Memory first, then the pages. Subpages always show, 16px further in.
  function tree(parentId: string | null, depth = 0, visited = new Set<string>()): ReactNode {
    const siblings = (children.get(parentId) || []).filter((p) => !visible || visible.has(p.id));
    return siblings.map((p, index) => {
      if (visited.has(p.id)) return null;
      const next = new Set(visited).add(p.id);
      const current = !pane && selected === p.id;
      const count = matches?.[p.id] || 0;
      return (
        <li key={p.id}>
          <PageRowMenu
            onSubpage={() => newPage(p.id)}
            onMove={() => command(p.id, 'move')}
            onSource={() => command(p.id, 'source')}
            onDelete={() => command(p.id, 'delete')}
          >
            <div
              className="wiki-tree-row row-focus"
              style={depth ? ({ '--depth': depth } as CSSProperties) : undefined}
              data-depth={depth || undefined}
              data-selected={current}
              data-dim={visible && !count ? '' : undefined}
              data-drop={drag?.over === p.id ? drag.position : undefined}
              draggable={!busy && !matches}
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
                  const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
                  if (target) place(p.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after');
                }}
              >
                {p.title || 'Untitled'}
                {count > 0 && (
                  <span className="sr-only">, {plural(count, 'match', 'matches')}</span>
                )}
              </button>
              {count > 0 && (
                <span className="knowledge-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </div>
          </PageRowMenu>
          {!!children.get(p.id)?.length && (
            <ul className="wiki-tree-children">{tree(p.id, depth + 1, next)}</ul>
          )}
        </li>
      );
    });
  }
  const pageActions: PageActions = {
    onAskAgent: askAgent,
    onMakeTasks: makeTasks,
    planTasksDisabled: planReason,
    onConnectBoard: connection ? undefined : () => connectThen('link'),
    onLinkTask: (task) => void setLink(task, true),
    onMakeTask: (text) => void makeTask(text),
  };
  const [otherRepository, setOtherRepository] = useState('');
  const repositoryValue = repositoryChoice?.value || '';
  const closeChoice = (value: string | null) => {
    repositoryChoice?.resolve(value);
    setRepositoryChoice(null);
    setOtherRepository('');
  };
  const typedRepository = otherRepository.trim();
  const chosenRepository = typedRepository || repositoryValue;
  return (
    <section className="project-docs knowledge" aria-label="Knowledge" data-rail-open={railOpen}>
      <aside className="knowledge-rail" aria-label="Knowledge sections">
        {find}
        <div className="knowledge-rail-scroll">
          {railLead}
          {pages.length > 0 && (
            <nav aria-label="Pages" className="knowledge-rail-pages">
              <ul className="wiki-page-tree">{tree(null)}</ul>
            </nav>
          )}
        </div>
        <button
          type="button"
          className="knowledge-new-page"
          aria-keyshortcuts={newPageKeys}
          disabled={busy}
          onClick={() => newPage(null)}
        >
          <Plus size={16} aria-hidden="true" />
          New page
          <kbd aria-hidden="true">{shortcutLabel(['mod', 'alt'], 'N')}</kbd>
        </button>
      </aside>
      {error && !pane && (
        <Alert variant="destructive" size="sm" className="knowledge-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {pane ? (
        <div className="knowledge-pane">{pane}</div>
      ) : page && page.id === selected ? (
        <div ref={workspace} className="doc-workspace">
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
            readCount={readCounts?.[page.id]}
            repoColor={repoColor}
            heading={heading}
            onDelete={() => {
              setError('');
              // A page with subpages cannot go: its subpages would lose their parent.
              if (hasSubpages)
                showToast({
                  message: 'Move or delete the subpages of this page first.',
                  tone: 'error',
                });
              else void deletePage(page);
            }}
          />
        </div>
      ) : (
        <div className="knowledge-pane">
          {switcher && <div className="knowledge-switcher-row">{switcher}</div>}
          <EmptyState
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
      {boardTasks !== undefined && (
        <TaskPicker
          open={linking}
          onOpenChange={setLinking}
          tasks={boardTasks}
          onPick={(task) => void setLink(task, true)}
          onCloseAutoFocus={(event) => event.preventDefault()}
        />
      )}
      <Dialog open={!!repositoryChoice} onOpenChange={(open) => !open && closeChoice(null)}>
        <DialogContent layout="scroll">
          <DialogHeader>
            <DialogTitle>Repository for new tasks</DialogTitle>
            <DialogDescription className="sr-only">
              Kalkidan adds the tasks as issues in this GitHub repository.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {boardRepositories.length > 0 && (
              <Choice
                label="Repository"
                value={repositoryValue || boardRepositories[0]}
                onChange={(value) =>
                  setRepositoryChoice((current) => current && { ...current, value })
                }
                options={boardRepositories.map((value) => ({ value, label: value }))}
              />
            )}
            <Input
              aria-label="Other repository"
              placeholder="owner/repository"
              value={otherRepository}
              onChange={(event) => setOtherRepository(event.target.value)}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeChoice(null)}>
              Cancel
            </Button>
            <Button
              disabled={!/^[\w.-]+\/[\w.-]+$/.test(chosenRepository || boardRepositories[0] || '')}
              onClick={() => closeChoice(chosenRepository || boardRepositories[0] || null)}
            >
              Use repository
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deletedPages !== null}
        onOpenChange={(open) => !open && !busy && setDeletedPages(null)}
      >
        <DialogContent layout="scroll">
          <DialogHeader>
            <DialogTitle>Recently deleted</DialogTitle>
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
                      <span
                        className="block text-xs text-muted-foreground"
                        title={fullTime(item.deletedAt)}
                      >
                        Deleted {editedText(item.deletedAt)}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Restore ${item.title}`}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await restore(item.trashId);
                          setDeletedPages((current) =>
                            (current || []).filter((d) => d.trashId !== item.trashId),
                          );
                        })
                      }
                    >
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No deleted pages" />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </section>
  );
}
