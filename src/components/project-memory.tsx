import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CircleDot,
  Code,
  File as FileIcon,
  FileText,
  Heading2,
  List,
  ListChecks,
  Trash2,
} from 'lucide-react';
import { Button } from './ui/button';
import { CaretMenu, TaskPicker, caretMenuHeight, menuPosition, taskHref } from './wiki-editor';
import { DocPagePicker } from './doc-page-picker';
import { Alert, AlertDescription } from './ui/alert';
import { MoreButton } from './ui/more-button';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import type { API, ProjectGroup, Session } from '../types';
import type {
  MemoryEntry,
  MemoryExtraction,
  MemoryWriteResult,
  ProjectMemory,
} from '../domain/memory';
import { trackerConnection, type TrackerItem } from '../domain/tracker';
import { useProjectResource } from '../hooks/use-project-resource';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { trackerClient } from '../lib/tracker-client';
import { fullTime, relativeTime } from '../lib/relative-time';
import {
  defaultMemoryTopic,
  bulletFacts,
  bulletHeading,
  factEdit,
  newFactTopic,
  topicRenameSaves,
} from '../domain/memory-outline';

type MemoryPage = ProjectMemory['pages'][number];

/** The text of a new or changed memory fact. */
export interface MemoryEntryInput {
  /** The fact to change. Undefined for a new fact. */
  id?: string;
  /** The revision that the user changed. The save stops when the fact changed meanwhile. */
  expectedRevision?: string;
  topic: string;
  content: string;
}

/** What the page shows after a save: a toast, a message at the form, or a page error. */
export function memorySaveOutcome(
  result: MemoryWriteResult,
):
  | { kind: 'saved'; topic: string }
  | { kind: 'duplicate' }
  | { kind: 'conflict' }
  | { kind: 'deferred'; reason: string } {
  if (result.status === 'conflict') return { kind: 'conflict' };
  if (result.status === 'deferred') return { kind: 'deferred', reason: result.reason };
  if (result.status === 'duplicate') return { kind: 'duplicate' };
  return { kind: 'saved', topic: memoryTopicName(result.entry) };
}

/** True when the topic or the text of a memory page contains each word of the search. */
export function memoryMatches(
  page: { topic?: string; name?: string; content: string },
  query: string,
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${memoryTopicName(page)} ${page.content}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The topic name of a memory page, with a capital first letter. */
export function memoryTopicName(page: { topic?: string; name?: string }) {
  const text = (page.topic || (page.name || '').replace(/\.md$/, '').replace(/[-_]/g, ' ')).trim();
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : 'Untitled topic';
}

/** Removes a first level-one heading that only repeats the topic. */
export function withoutRepeatedTitle(content: string, topic: string) {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(content);
  if (!match) return content;
  const plain = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return plain(match[1]) === plain(topic) ? content.slice(match[0].length).trimStart() : content;
}

/** Finds the entry of a memory page: the same topic and text, else the same topic. */
export function entryForPage(page: MemoryPage, entries: MemoryEntry[] | undefined) {
  if (!entries?.length) return undefined;
  const topic = (page.topic || page.name.replace(/\.md$/, '')).trim().toLowerCase();
  const same = entries.filter((entry) => entry.topic.trim().toLowerCase() === topic);
  return same.find((entry) => entry.content === page.content) || same[0];
}

/** The last memory update in plain words, without the chat title. */
export function extractionText(extraction: MemoryExtraction) {
  switch (extraction.status) {
    case 'queued':
      return 'Waiting to save memory';
    case 'extracting':
      return 'Reading the chat';
    case 'validating':
      return 'Checking the new facts';
    case 'saved':
      return extraction.saved ? `Saved ${plural(extraction.saved, 'fact')}` : 'Nothing new to save';
    case 'skipped':
      return 'Nothing new to save';
    case 'failed':
      return 'Could not save memory';
  }
}

/** One fact of project memory. `entry` is missing for an older desktop app. */
export interface MemoryFact {
  id: string;
  topic: string;
  content: string;
  updatedAt: string;
  /** When the fact was added. Memory lists the facts in this order, as lines on a page. */
  createdAt: string;
  truncated?: boolean;
  entry?: MemoryEntry;
}

/**
 * The facts of project memory, in the order of a page: the topics in the order they were added,
 * then the facts of each topic, oldest first. A new fact goes to the end of its topic. The
 * entries give the facts. Without entries (an older desktop app), each memory page is one fact.
 */
export function memoryFacts(memory: ProjectMemory | undefined, entries: MemoryEntry[] | undefined) {
  const facts: MemoryFact[] = entries?.length
    ? entries.map((entry) => ({
        id: entry.id,
        topic: memoryTopicName(entry),
        content: entry.content,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt || entry.updatedAt,
        entry,
      }))
    : (memory?.pages || []).map((page) => ({
        id: page.name,
        topic: memoryTopicName(page),
        content: withoutRepeatedTitle(page.content, memoryTopicName(page)),
        updatedAt: page.updatedAt,
        createdAt: page.updatedAt,
        truncated: page.truncated,
      }));
  // A topic starts when its first fact was added.
  const topicStart = new Map<string, string>();
  for (const fact of facts) {
    const key = fact.topic.toLowerCase();
    const start = topicStart.get(key);
    if (!start || fact.createdAt < start) topicStart.set(key, fact.createdAt);
  }
  const startOf = (fact: MemoryFact) => topicStart.get(fact.topic.toLowerCase()) || '';
  return facts.sort(
    (a, b) =>
      startOf(a).localeCompare(startOf(b)) ||
      a.topic.localeCompare(b.topic) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/** The facts grouped by topic, in topic order. */
export function factTopics(facts: MemoryFact[]) {
  const topics = new Map<string, MemoryFact[]>();
  for (const fact of facts) topics.set(fact.topic, [...(topics.get(fact.topic) || []), fact]);
  return [...topics].map(([topic, items]) => ({ topic, facts: items }));
}

/** The DOM ID of a memory topic heading. The Knowledge rail scrolls to it. */
export const topicAnchor = (topic: string) =>
  'memory-topic-' + topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * The memory facts and entries of a project. The Knowledge rail and the Memory pane share the
 * memory resource, so both show the same facts.
 */
export function useMemoryFacts(api: API, group: ProjectGroup) {
  const resource = useProjectResource(api, group, 'memory', () => api.memoryList(group.id));
  const memory = resource.state.value;
  const [entries, setEntries] = useState<MemoryEntry[]>();
  // Entries give the source chat and the revision. Older desktop apps do not have them.
  useEffect(() => {
    if (!memory || typeof api.memoryEntries !== 'function') return;
    let live = true;
    api
      .memoryEntries(group.id)
      .then((value) => live && setEntries(value))
      .catch(() => live && setEntries(undefined));
    return () => {
      live = false;
    };
  }, [api, group.id, memory]);
  const facts = useMemo(() => memoryFacts(memory, entries), [memory, entries]);
  return { resource, memory, entries, setEntries, facts };
}

const openSession = (session: Session) =>
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-session', { detail: { agent: session.agent, id: session.id } }),
  );

/**
 * A link to the source chat of a fact: "from a chat". It is meta text: muted, with an underline
 * on hover. The chat title shows in the tooltip and the accessible name.
 */
function SessionLink({ session }: { session: Session }) {
  const title = session.title || 'Untitled chat';
  return (
    <Button
      type="button"
      variant="link"
      title={title}
      aria-label={`From ${title}`}
      className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => openSession(session)}
    >
      from a chat
    </Button>
  );
}

/** A line of the memory page that has not been saved yet. */
interface Draft {
  key: string;
  /** The section of the line: an existing topic or a new topic. */
  section: string;
  /** The line that this line follows: a heading, a fact, another draft, or the section end. */
  after: string;
  text: string;
  busy?: boolean;
  error?: string;
}

/** A topic that the user typed as a heading. It is saved with its first fact. */
interface NewTopic {
  key: string;
  name: string;
}

const topicSection = (topic: string) => 'topic:' + topic.toLowerCase();
/** The section of the first fact when memory has no topic. */
const emptySection = topicSection(defaultMemoryTopic);
const endOf = (section: string) => 'end:' + section;
let draftSerial = 0;
const nextKey = () => String(++draftSerial);

/** The line of the memory page where the caret is: at the start, at the end or neither. */
function caretAt(element: HTMLTextAreaElement | HTMLInputElement) {
  const { selectionStart, selectionEnd, value } = element;
  if (selectionStart !== selectionEnd) return undefined;
  if (selectionStart === 0) return 'start';
  return selectionStart === value.length ? 'end' : undefined;
}

/** The keys that every line of the memory page shares. */
interface LineKeys {
  onEnter: () => void;
  onEscape?: () => void;
  /** Backspace in an empty line. */
  onRemove?: () => void;
  onMove: (step: -1 | 1) => void;
}

function lineKeyDown(event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, keys: LineKeys) {
  const target = event.currentTarget;
  if (event.nativeEvent.isComposing) return;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    keys.onEnter();
  } else if (event.key === 'Escape' && keys.onEscape) {
    event.preventDefault();
    event.stopPropagation();
    keys.onEscape();
  } else if (event.key === 'Backspace' && !target.value && keys.onRemove) {
    event.preventDefault();
    keys.onRemove();
  } else if (event.key === 'ArrowUp' && caretAt(target) === 'start') {
    event.preventDefault();
    keys.onMove(-1);
  } else if (event.key === 'ArrowDown' && (caretAt(target) === 'end' || !target.value)) {
    event.preventDefault();
    keys.onMove(1);
  }
}

/** Puts focus in a field with the caret at the end. */
function focusEnd(element: HTMLTextAreaElement | HTMLInputElement | null | undefined) {
  if (!element) return;
  element.focus({ preventScroll: false });
  const end = element.value.length;
  element.setSelectionRange(end, end);
}

/** The rows of "/" in a Memory line: a heading is a topic, a bullet is a fact. */
const memoryCommands = [
  { key: 'topic', icon: Heading2, label: 'Topic', hint: '##' },
  { key: 'fact', icon: List, label: 'Fact', hint: '-' },
  { key: 'checklist', icon: ListChecks, label: 'Checklist', hint: '[]' },
  { key: 'code', icon: Code, label: 'Code', hint: '```' },
  { key: 'page', icon: FileIcon, label: 'Link a page', hint: '[[' },
  { key: 'task', icon: CircleDot, label: 'Link a task', hint: '#' },
] as const;
type MemoryCommand = (typeof memoryCommands)[number]['key'];

/** The rows of "/" for the typed text after it. "Link a task" shows only with a board. */
export function memoryCommandRows(query: string, board = false) {
  const text = query.trim().toLowerCase();
  return memoryCommands.filter(
    (command) =>
      (board || command.key !== 'task') &&
      (!text ||
        command.label
          .toLowerCase()
          .split(' ')
          .some((w) => w.startsWith(text))),
  );
}

/** The "/" menu of a Memory line, while the line holds only "/" and a search text. */
interface LineMenu {
  rows: (typeof memoryCommands)[number][];
  index: number;
  left: number;
  top: number;
}

/** A bullet field: one line that grows with its text. "/" opens the block menu. */
function BulletInput({
  value,
  label,
  placeholder,
  disabled,
  item,
  focusKey,
  onChange,
  onBlur,
  keys,
  onCommand,
  board,
}: {
  value: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** The key of the line for focus requests and arrow keys. */
  item: string;
  focusKey?: { key: string; serial: number };
  onChange: (value: string) => void;
  onBlur?: () => void;
  keys: LineKeys;
  /** Runs a row of the "/" menu. Without it, "/" is text. */
  onCommand?: (command: MemoryCommand) => void;
  /** True when the project has a board: "/" then also offers "Link a task". */
  board?: boolean;
}) {
  const [menu, setMenu] = useState<LineMenu | null>(null);
  const menuId = useId();
  /** Opens, filters or closes the "/" menu for the text of the line. */
  function slash(text: string) {
    const match = onCommand && /^\/(\w*)$/.exec(text);
    const rows = match ? memoryCommandRows(match[1], board) : [];
    if (!match || !field.current) {
      setMenu(null);
      return;
    }
    // The menu goes 8px under the line: the field and the 2px padding of the line under it.
    const place = () => {
      const box = field.current!.getBoundingClientRect();
      return menuPosition(
        { left: box.left, top: box.top, bottom: box.bottom + 2 },
        caretMenuHeight(rows.length),
      );
    };
    setMenu((current) => ({
      rows,
      index: Math.min(current?.index ?? 0, Math.max(0, rows.length - 1)),
      ...place(),
    }));
    // The line moves left when it shows the menu (no bullet). Measure again after that.
    requestAnimationFrame(
      () => field.current && setMenu((current) => current && { ...current, ...place() }),
    );
  }
  function run(index: number) {
    const row = menu?.rows[index];
    setMenu(null);
    if (row) onCommand?.(row.key);
  }
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (focusKey?.key === item) focusEnd(field.current);
  }, [focusKey?.serial]);
  return (
    <>
      <textarea
        ref={field}
        data-memory-item={item}
        data-slash={menu ? '' : undefined}
        className="memory-line-input"
        aria-label={label}
        placeholder={placeholder}
        rows={1}
        maxLength={2000}
        value={value}
        disabled={disabled}
        aria-controls={menu ? `${menuId}-list` : undefined}
        aria-activedescendant={menu?.rows.length ? `${menuId}-${menu.index}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          slash(event.target.value);
        }}
        onBlur={() => {
          setMenu(null);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (menu && !event.nativeEvent.isComposing) {
            const count = menu.rows.length;
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count) {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setMenu({ ...menu, index: (menu.index + step + count) % count });
              return;
            }
            if (event.key === 'Enter' && count) {
              event.preventDefault();
              run(menu.index);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setMenu(null);
              return;
            }
          }
          lineKeyDown(event, keys);
        }}
      />
      {menu && (
        <CaretMenu
          id={menuId}
          label="Insert block"
          position={menu}
          rows={menu.rows.map((row) => ({ ...row }))}
          active={menu.index}
          empty="No matching blocks"
          onActive={(index) => setMenu({ ...menu, index })}
          onPick={run}
        />
      )}
    </>
  );
}

/** A topic heading. A change renames the topic of each of its facts. */
function TopicHeading({
  name,
  item,
  anchor,
  editable,
  focusKey,
  onRename,
  keys,
}: {
  name: string;
  item: string;
  anchor?: string;
  editable: boolean;
  focusKey?: { key: string; serial: number };
  /** Saves the new name. Undefined while the topic is new: the name saves with a fact. */
  onRename: (name: string) => void;
  keys: LineKeys;
}) {
  const [text, setText] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== field.current) setText(name);
  }, [name]);
  useLayoutEffect(() => {
    if (focusKey?.key === item) focusEnd(field.current);
  }, [focusKey?.serial]);
  return (
    <h3 id={anchor} className="memory-topic-title">
      <input
        ref={field}
        data-memory-item={item}
        className="memory-topic-input"
        aria-label="Topic"
        placeholder="Topic"
        maxLength={120}
        value={text}
        readOnly={!editable}
        onChange={(event) => {
          setText(event.target.value);
          if (!anchor) onRename(event.target.value);
        }}
        onBlur={() => {
          if (anchor && text.trim() && text.trim() !== name) onRename(text);
          else if (anchor) setText(name);
        }}
        onKeyDown={(event) =>
          lineKeyDown(event, {
            ...keys,
            onEscape: () => {
              setText(name);
              event.currentTarget.blur();
            },
          })
        }
      />
    </h3>
  );
}

/**
 * One saved fact: its text as Markdown, and a field when the user clicks or moves to it. The
 * source and the age show on hover.
 */
function FactLine({
  fact,
  meta,
  highlight,
  focusKey,
  onSave,
  onRemove,
  onPromote,
  keys,
}: {
  fact: MemoryFact;
  meta: ReactNode;
  highlight: boolean;
  focusKey?: { key: string; serial: number };
  onSave: (content: string) => Promise<string>;
  onRemove: () => void;
  onPromote: () => void;
  keys: Omit<LineKeys, 'onRemove' | 'onEnter'> & { onEnter: () => void };
}) {
  const item = 'fact:' + fact.id;
  const editable = !!fact.entry;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  // Escape ends the edit without a save, also when the field then loses focus.
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setText(fact.content);
  }, [fact.content, editing]);
  useLayoutEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    focusEnd(field.current);
  }, [editing]);
  useEffect(() => {
    if (focusKey?.key === item && editable) setEditing(true);
  }, [focusKey?.serial]);
  /** Saves a changed text. An empty text removes the fact. */
  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return true;
    }
    const change = factEdit(fact.content, text);
    if (change.kind === 'none') return true;
    if (change.kind === 'remove') {
      onRemove();
      return true;
    }
    setBusy(true);
    const message = await onSave(change.content);
    setBusy(false);
    setError(message);
    return !message;
  }
  return (
    <li
      className="memory-line memory-fact"
      data-fact={fact.id}
      data-highlight={highlight || undefined}
      data-editing={editing || undefined}
    >
      {editing ? (
        <textarea
          ref={field}
          data-memory-item={item}
          className="memory-line-input"
          aria-label="Fact"
          rows={1}
          maxLength={2000}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setError('');
          }}
          onBlur={() => void commit().then((ok) => ok && setEditing(false))}
          onKeyDown={(event) =>
            lineKeyDown(event, {
              ...keys,
              onEnter: () => void commit().then((ok) => ok && keys.onEnter()),
              onEscape: () => {
                cancelled.current = true;
                setText(fact.content);
                setError('');
                setEditing(false);
              },
              onRemove,
            })
          }
        />
      ) : (
        <div
          data-memory-item={item}
          tabIndex={editable ? 0 : -1}
          role={editable ? 'button' : undefined}
          aria-label={editable ? `Edit fact: ${fact.content.slice(0, 80)}` : undefined}
          className="prose-ui memory-fact-text"
          onFocus={() => editable && setEditing(true)}
          onClick={(event) => {
            // A link in the fact opens. A click on the text edits the fact.
            if ((event.target as Element).closest('a')) return;
            if (editable) setEditing(true);
          }}
        >
          <Markdown skipHtml remarkPlugins={[remarkGfm]}>
            {fact.content}
          </Markdown>
          {fact.truncated && <p className="memory-fact-meta">Only the first 64 KB shows.</p>}
        </div>
      )}
      <div className="memory-fact-aside">
        {meta}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton size="xs" label="Fact actions" disabled={busy} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onPromote}>
              <FileText className="size-4" aria-hidden="true" />
              Make a page from this fact
            </DropdownMenuItem>
            {editable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove fact
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p role="alert" className="field-error memory-line-error">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The Memory page of the Knowledge tab. It reads as a page: each topic is a heading and each
 * fact is a bullet. A new bullet adds a fact, a changed bullet saves the fact, and an empty
 * bullet removes it. "## " at the start of a bullet starts a new topic.
 */
export function ProjectMemoryPanel({
  api,
  group,
  sessions: sessionsProp,
  topic: topicProp = '',
  focus,
  autoFocus = false,
  readCounts,
  switcher,
}: {
  api: API;
  group: ProjectGroup;
  /** The chats of the app. They give the titles of the source chats. */
  sessions?: Session[];
  /** Scrolls to the heading of this topic. */
  topic?: string;
  /** Scrolls to this fact and highlights it. The serial repeats a request. */
  focus?: { id: string; serial: number };
  /** Puts the caret in "Add a fact" when memory has no facts. */
  autoFocus?: boolean;
  /** The number of chats that read each fact. */
  readCounts?: Record<string, number>;
  /** The Knowledge switcher for a narrow window. */
  switcher?: ReactNode;
}) {
  const { resource, memory, entries, setEntries, facts } = useMemoryFacts(api, group);
  const { state, refresh } = resource;
  const error = state.error || '';
  const [loadedSessions, setLoadedSessions] = useState<Session[]>();
  const [actionError, setActionError] = useState('');
  const [highlight, setHighlight] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [newTopics, setNewTopics] = useState<NewTopic[]>([]);
  const [ghost, setGhost] = useState('');
  const [focusKey, setFocusKey] = useState<{ key: string; serial: number }>();
  const sessions = sessionsProp || loadedSessions;
  const list = useRef<HTMLDivElement>(null);
  const topics = useMemo(() => factTopics(facts), [facts]);
  const topicNames = topics.map((item) => item.topic);
  const focusLine = (key: string) =>
    setFocusKey((current) => ({ key, serial: (current?.serial ?? 0) + 1 }));

  // Without the chats from the app, read them once to show the source chat titles.
  useEffect(() => {
    if (sessionsProp || loadedSessions || !entries?.some((entry) => entry.source.sessionId)) return;
    let live = true;
    api
      .snapshot()
      .then((snapshot) => live && setLoadedSessions(snapshot.sessions))
      .catch(() => live && setLoadedSessions([]));
    return () => {
      live = false;
    };
  }, [api, sessionsProp, loadedSessions, entries]);
  // A new project opens here with the caret in "Add a fact".
  const autoFocused = useRef(false);
  useEffect(() => {
    if (!autoFocus || autoFocused.current || !memory || facts.length) return;
    autoFocused.current = true;
    focusLine('ghost');
  }, [autoFocus, !!memory, facts.length]);
  useEffect(() => {
    if (!topicProp) return;
    const name = topicNames.find((value) => value.toLowerCase() === topicProp.toLowerCase());
    if (name) document.getElementById(topicAnchor(name))?.scrollIntoView({ block: 'start' });
  }, [topicProp, topicNames.length > 0]);
  useEffect(() => {
    if (!focus || !facts.length) return;
    setHighlight(focus.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-fact="${CSS.escape(focus.id)}"]`)
      ?.scrollIntoView({ block: 'center' });
    const timer = setTimeout(() => setHighlight(''), 2000);
    return () => clearTimeout(timer);
  }, [focus?.serial, facts.length > 0]);
  // A new topic joins the saved topic of the same name after its first fact saves.
  useEffect(() => {
    const saved = (name: string) =>
      topicNames.find((value) => value.toLowerCase() === name.trim().toLowerCase());
    const merged = newTopics.filter(
      (item) =>
        saved(item.name) &&
        !document.activeElement?.matches(`[data-memory-item="new:${CSS.escape(item.key)}"]`),
    );
    if (!merged.length) return;
    setNewTopics((current) => current.filter((item) => !merged.includes(item)));
    setDrafts((current) =>
      current.map((draft) => {
        const from = merged.find((item) => draft.section === 'new:' + item.key);
        if (!from) return draft;
        const section = topicSection(saved(from.name)!);
        return {
          ...draft,
          section,
          after: draft.after === 'heading:new:' + from.key ? endOf(section) : draft.after,
        };
      }),
    );
  }, [facts]);

  const sessionOf = (id?: string) => (id ? sessions?.find((s) => s.id === id) : undefined);
  const extraction = memory?.extraction;
  const extracting =
    extraction && ['queued', 'extracting', 'validating'].includes(extraction.status);

  /** Adds or replaces an entry in the list at once. The memory then loads again. */
  function upsert(entry: MemoryEntry) {
    setEntries((current) => [...(current || []).filter((item) => item.id !== entry.id), entry]);
  }
  /** Saves one fact. Returns an error message, or '' after a save. */
  async function save(input: MemoryEntryInput) {
    try {
      const result = await api.memorySave(group.id, {
        ...input,
        topic: input.topic.trim(),
        content: input.content.trim(),
      });
      const outcome = memorySaveOutcome(result);
      if (outcome.kind === 'saved' && result.status === 'saved') {
        upsert(result.entry);
        void refresh();
        return '';
      }
      if (outcome.kind === 'duplicate') return 'Memory has this fact already.';
      if (outcome.kind === 'conflict') {
        void refresh();
        return 'This fact changed. Kalkidan loaded the new text.';
      }
      return outcome.kind === 'deferred' ? outcome.reason : '';
    } catch (failure) {
      return errorMessage(failure);
    }
  }
  /** Removes a fact. Undo in the toast adds it again. */
  async function remove(fact: MemoryFact) {
    const entry = fact.entry;
    if (!entry) return;
    setActionError('');
    try {
      await api.memoryForget(group.id, entry.id, entry.revision);
      setEntries((current) => current?.filter((item) => item.id !== entry.id));
      void refresh();
      showToast({
        message: 'Fact removed.',
        actions: [
          {
            label: 'Undo',
            onClick: () =>
              void save({ topic: entry.topic, content: entry.content }).then(
                (message) => message && setActionError(message),
              ),
          },
        ],
      });
    } catch (failure) {
      setActionError(errorMessage(failure));
    }
  }
  async function rename(from: string, to: string) {
    setActionError('');
    for (const input of topicRenameSaves(entries || [], from, to)) {
      const message = await save(input);
      if (message) {
        setActionError(message);
        break;
      }
    }
  }
  async function promote(fact: MemoryFact) {
    setActionError('');
    try {
      const doc = await api.docsCreate(group.id, fact.topic, null);
      await api.docsSave(group.id, { ...doc, markdown: fact.content });
      showToast({
        message: `Page “${fact.topic}” added.`,
        actions: [
          {
            label: 'Open',
            onClick: () =>
              window.dispatchEvent(
                new CustomEvent('kalkidan-open-project-page', {
                  detail: { groupId: group.id, page: 'knowledge', section: 'pages', docId: doc.id },
                }),
              ),
          },
        ],
      });
    } catch (failure) {
      setActionError(errorMessage(failure));
    }
  }

  // The sections of the page: the saved topics, then the topics that the user started.
  const sections = [
    ...topics.map((item) => ({
      key: topicSection(item.topic),
      name: item.topic,
      facts: item.facts,
      fresh: undefined as NewTopic | undefined,
    })),
    ...newTopics.map((item) => ({
      key: 'new:' + item.key,
      name: item.name,
      facts: [] as MemoryFact[],
      fresh: item,
    })),
  ];
  const lastSection = sections[sections.length - 1];
  const sectionName = (key: string) => sections.find((item) => item.key === key)?.name;

  /** Moves the caret to the line before or after a line, in page order. */
  function move(item: string, step: -1 | 1) {
    const lines = [...(list.current?.querySelectorAll<HTMLElement>('[data-memory-item]') || [])];
    const index = lines.findIndex((line) => line.dataset.memoryItem === item);
    const next = lines[index + step];
    if (!next) return;
    if (next instanceof HTMLTextAreaElement || next instanceof HTMLInputElement) focusEnd(next);
    else next.focus();
  }
  const updateDraft = (key: string, change: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)),
    );
  /** Adds an empty line after a line and puts the caret in it. */
  function addLine(section: string, after: string) {
    const key = nextKey();
    setDrafts((current) => [...current, { key, section, after, text: '' }]);
    focusLine('draft:' + key);
  }
  /** Starts a new topic at the end of the page from "## " in a line. */
  function startTopic(name: string) {
    const key = nextKey();
    setNewTopics((current) => [...current, { key, name }]);
    focusLine('new:' + key);
  }
  /** Saves the facts of a line. The line stays with a message when a save fails. */
  async function saveDraft(draft: Draft) {
    const contents = bulletFacts(draft.text);
    if (!contents.length) {
      setDrafts((current) => current.filter((item) => item.key !== draft.key));
      return;
    }
    const topic = newFactTopic(sectionName(draft.section), topicNames);
    updateDraft(draft.key, { busy: true, error: '' });
    let failed = '';
    let left = [...contents];
    for (const content of contents) {
      const message = await save({ topic, content });
      if (message) {
        failed = message;
        break;
      }
      left = left.slice(1);
    }
    if (!failed) setDrafts((current) => current.filter((item) => item.key !== draft.key));
    else updateDraft(draft.key, { busy: false, error: failed, text: left.join('\n') });
  }
  /** Sets the text of an unsaved line: "Add a fact" or a new line. */
  function setLineText(item: string, text: string) {
    if (item === 'ghost') setGhost(text);
    else updateDraft(item.replace(/^draft:/, ''), { text, error: '' });
  }
  // The line that "Link a page" in "/" adds a page link to.
  const [linkLine, setLinkLine] = useState('');
  // The line that "Link a task" in "/" adds a task link to, and the board tasks (null: loading).
  // The board loads only when "Link a task" is chosen.
  const [taskLine, setTaskLine] = useState('');
  const [boardTasks, setBoardTasks] = useState<TrackerItem[] | null>(null);
  const connection = trackerConnection(group);
  function loadTasks() {
    if (!connection) return;
    setBoardTasks(null);
    trackerClient(api, connection.provider || 'github')
      .board(group.id)
      .then((board) => setBoardTasks(board.items))
      .catch((reason) => {
        setBoardTasks([]);
        setActionError(errorMessage(reason));
      });
  }
  /** Runs a row of the "/" menu in an unsaved line. */
  function runCommand(item: string, command: MemoryCommand) {
    if (command === 'topic') {
      if (item === 'ghost') setGhost('');
      else setDrafts((current) => current.filter((draft) => 'draft:' + draft.key !== item));
      startTopic('');
    } else if (command === 'page') {
      setLineText(item, '');
      setLinkLine(item);
    } else if (command === 'task') {
      setLineText(item, '');
      setTaskLine(item);
      loadTasks();
    } else setLineText(item, command === 'checklist' ? '[ ] ' : command === 'code' ? '`' : '');
  }
  /** Turns the text of "Add a fact" into a line of the last section, then saves it. */
  function submitGhost(keepFocus: boolean) {
    const text = ghost;
    if (!bulletFacts(text).length) return;
    const section = lastSection?.key || emptySection;
    const draft: Draft = { key: nextKey(), section, after: endOf(section), text };
    setDrafts((current) => [...current, draft]);
    setGhost('');
    if (keepFocus) focusLine('ghost');
    void saveDraft(draft);
  }

  function factMeta(fact: MemoryFact) {
    const entry = fact.entry;
    const source = sessionOf(entry?.source.sessionId);
    const reads = readCounts?.[fact.id] || 0;
    return (
      <p className="memory-fact-meta">
        {/* Where the fact came from and its age: "from a chat · 12h". */}
        {entry?.provenance === 'user' ? (
          <span>added by you</span>
        ) : source ? (
          <SessionLink session={source} />
        ) : entry?.provenance === 'external' ? (
          <span>changed outside Kalkidan</span>
        ) : null}
        <span
          title={[fullTime(fact.updatedAt), reads ? `read in ${plural(reads, 'chat')}` : '']
            .filter(Boolean)
            .join(' · ')}
        >
          {relativeTime(fact.updatedAt)}
        </span>
      </p>
    );
  }

  /** The unsaved lines after a line, each followed by the lines after it. */
  function draftsAfter(after: string, shown: Set<string>): ReactNode[] {
    return drafts
      .filter((draft) => draft.after === after && !shown.has(draft.key))
      .flatMap((draft) => {
        shown.add(draft.key);
        const item = 'draft:' + draft.key;
        return [
          <li key={item} className="memory-line" data-draft="">
            <BulletInput
              item={item}
              label="New fact"
              value={draft.text}
              disabled={draft.busy}
              focusKey={focusKey}
              onCommand={(command) => runCommand(item, command)}
              board={!!connection}
              onChange={(text) => {
                const heading = bulletHeading(text);
                if (heading !== null) {
                  setDrafts((current) => current.filter((value) => value.key !== draft.key));
                  startTopic(heading);
                } else updateDraft(draft.key, { text, error: '' });
              }}
              onBlur={() => {
                const current = drafts.find((value) => value.key === draft.key);
                if (current && !current.busy) void saveDraft({ ...current });
              }}
              keys={{
                onEnter: () => {
                  if (!draft.text.trim()) return;
                  addLine(draft.section, item);
                },
                onRemove: () => {
                  move(item, -1);
                  setDrafts((current) => current.filter((value) => value.key !== draft.key));
                },
                onMove: (step) => move(item, step),
              }}
            />
            {draft.error && (
              <p role="alert" className="field-error memory-line-error">
                {draft.error}
              </p>
            )}
          </li>,
          ...draftsAfter(item, shown),
        ];
      });
  }

  const ghostLine = (
    <li key="ghost" className="memory-line" data-ghost="">
      <BulletInput
        item="ghost"
        label="Add a fact"
        placeholder="Add a fact"
        value={ghost}
        focusKey={focusKey}
        onCommand={(command) => runCommand('ghost', command)}
        board={!!connection}
        onChange={(text) => {
          const heading = bulletHeading(text);
          if (heading !== null) {
            setGhost('');
            startTopic(heading);
          } else setGhost(text);
        }}
        onBlur={() => submitGhost(false)}
        keys={{
          onEnter: () => submitGhost(true),
          onRemove: () => {
            // Backspace in an empty new topic removes the topic.
            const fresh = lastSection?.fresh;
            if (fresh && !drafts.some((draft) => draft.section === lastSection.key)) {
              setNewTopics((current) => current.filter((item) => item !== fresh));
              focusLine(
                sections[sections.length - 2]?.facts.length
                  ? 'fact:' + sections[sections.length - 2].facts.at(-1)!.id
                  : 'ghost',
              );
            } else move('ghost', -1);
          },
          onMove: (step) => move('ghost', step),
        }}
      />
    </li>
  );

  return (
    <section className="project-memory" aria-label="Memory">
      {switcher && <div className="knowledge-switcher-row">{switcher}</div>}
      {/* Memory is a page: the same title, meta line and text column as a page. */}
      <h2 className="doc-title memory-title">Memory</h2>
      <p className="doc-meta" role={extracting ? 'status' : undefined}>
        {extracting && extraction ? `${extractionText(extraction)}…` : 'Every session reads this'}
      </p>
      {extraction?.status === 'failed' && extraction.error && (
        <Alert variant="destructive" size="sm" className="mb-4">
          <AlertDescription>{extraction.error}</AlertDescription>
        </Alert>
      )}
      {(error || actionError) && (
        <Alert variant="destructive" size="sm" className="mb-4">
          <AlertDescription>{actionError || error}</AlertDescription>
        </Alert>
      )}
      {!memory && !error ? (
        <p className="form-help m-0" role="status">
          Loading memory…
        </p>
      ) : (
        <div ref={list} className="memory-list">
          {sections.map((section) => {
            const shown = new Set<string>();
            const headingItem = 'heading:' + section.key;
            const headingKey = section.fresh ? 'new:' + section.fresh.key : headingItem;
            const firstLine = () => {
              if (section === lastSection && !section.facts.length) focusLine('ghost');
              else addLine(section.key, headingItem);
            };
            return (
              <section
                key={section.key}
                aria-labelledby={section.fresh ? undefined : topicAnchor(section.name)}
              >
                <TopicHeading
                  name={section.name}
                  item={headingKey}
                  anchor={section.fresh ? undefined : topicAnchor(section.name)}
                  editable={!!section.fresh || section.facts.some((fact) => !!fact.entry)}
                  focusKey={focusKey}
                  onRename={(name) =>
                    section.fresh
                      ? setNewTopics((current) =>
                          current.map((item) =>
                            item.key === section.fresh!.key ? { ...item, name } : item,
                          ),
                        )
                      : void rename(section.name, name)
                  }
                  keys={{
                    onEnter: firstLine,
                    onMove: (step) => move(headingKey, step),
                  }}
                />
                <ul className="memory-facts">
                  {draftsAfter(headingItem, shown)}
                  {section.facts.map((fact) => [
                    <FactLine
                      key={fact.id}
                      fact={fact}
                      meta={factMeta(fact)}
                      highlight={highlight === fact.id}
                      focusKey={focusKey}
                      onSave={(content) =>
                        save({
                          id: fact.entry!.id,
                          expectedRevision: fact.entry!.revision,
                          topic: fact.entry!.topic,
                          content,
                        })
                      }
                      onRemove={() => {
                        move('fact:' + fact.id, -1);
                        void remove(fact);
                      }}
                      onPromote={() => void promote(fact)}
                      keys={{
                        onEnter: () => addLine(section.key, 'fact:' + fact.id),
                        onMove: (step) => move('fact:' + fact.id, step),
                      }}
                    />,
                    ...draftsAfter('fact:' + fact.id, shown),
                  ])}
                  {draftsAfter(endOf(section.key), shown)}
                  {/* Lines after a fact that is gone stay at the end of their topic. */}
                  {drafts
                    .filter((draft) => draft.section === section.key && !shown.has(draft.key))
                    .flatMap((draft) => draftsAfter(draft.after, shown))}
                </ul>
              </section>
            );
          })}
          {/* "Add a fact" stays in one place, so it keeps focus when its fact saves. */}
          <ul className="memory-facts" data-ghost-list="">
            {!sections.length && draftsAfter(endOf(emptySection), new Set())}
            {ghostLine}
          </ul>
        </div>
      )}
      <DocPagePicker
        api={api}
        groupId={group.id}
        open={!!linkLine}
        onOpenChange={(open) => !open && setLinkLine('')}
        onPick={(doc) => {
          setLineText(linkLine, `[${doc.title || 'Untitled'}](./${doc.id}.md) `);
          focusLine(linkLine);
        }}
        title="Link a page"
        onCloseAutoFocus={(event) => event.preventDefault()}
      />
      <TaskPicker
        open={!!taskLine}
        onOpenChange={(open) => !open && setTaskLine('')}
        tasks={boardTasks}
        onPick={(task) => {
          const label = task.number ? `#${task.number} ${task.title}` : task.title || 'Task';
          setLineText(taskLine, `[${label}](${taskHref(task)}) `);
          focusLine(taskLine);
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      />
      {memory?.limited && (
        <Alert role={undefined} size="sm" className="mt-6">
          <AlertDescription>
            Some files do not show here. They stay in the memory folder of the project.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
