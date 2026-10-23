import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Brain,
  Clock,
  FileText,
  Folder,
  FolderGit2,
  ListTodo,
  MessageSquarePlus,
  Search,
  X,
  Zap,
} from 'lucide-react';
import { trackerConnection, type TrackerItem } from '../domain/tracker';
import type { DocPassage, ProjectDocMetadata } from '../domain/docs';
import type { MemoryEntry } from '../domain/memory';
import { sessionAPI } from '../lib/remote-api';
import { sessionRepo } from '../lib/session-repository';
import { trackerClient } from '../lib/tracker-client';
import { isMac, plural, shortcutLabel } from '../lib/platform';
import type { API, Project, ProjectGroup, Session } from '../types';
import { relativeTime } from '../lib/relative-time';
import {
  ChatStatusGlyph,
  activityKey,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { IdentityMark, IdentityToken } from './ui/identity-mark';
import type { IdentityColor, IdentityKind } from '../domain/identity';

type Transcript = { messages: { text: string }[]; truncated: boolean };

interface SearchOption {
  key: string;
  open: () => void;
}
/** A command in the search field, such as "Open settings". */
export interface SearchAction {
  key: string;
  label: string;
  /** More words that find the action, such as "preferences" for "Open settings". */
  keywords?: string;
  /** A keyboard shortcut to show next to the label. */
  shortcut?: string;
  /** The icon of the action, such as the agent mark for "New Codex chat". */
  icon?: ReactNode;
  run: () => void;
}

/**
 * A chat, task, page or project that the user opened before, for "Recent" in an empty search.
 * A chat that waits for the user uses the same shape, for "Needs you".
 */
export interface RecentPlace {
  key: string;
  label: string;
  /** The project and the kind or agent, shown after the label. */
  context?: string;
  kind: 'chat' | 'task' | 'doc' | 'project';
  agent?: string;
  /** The identity mark of the item: a session dot or a project square. */
  mark?: { kind: IdentityKind; color: IdentityColor };
  /** The project of the item, as a mark and a name at the right side. */
  place?: { name: string; color: IdentityColor };
  /** Allows the approval that the chat waits for. The selected row shows it; Mod+Enter runs it. */
  allow?: () => void;
  open: () => void;
}
/** The identity colors of the items that search finds. */
export interface SearchMarks {
  session: (session: Session) => IdentityColor;
  project: (group: ProjectGroup) => IdentityColor;
  repo: (repo: Project) => IdentityColor;
}

/** The words of a text, for word-start matching. "Re-check auth_flow" → re, check, auth, flow. */
const wordsOf = (text: string) =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}#]+/u)
    .filter(Boolean);
/**
 * True when each word of the query starts a word of the text: "auth" finds "Authentication" and
 * "auth tokens", but not "OAuth". A query with one word of 3 or more letters also finds a
 * longer word that contains it, so "#12" and "12" find "Task #12".
 */
export function wordStartMatch(text: string, term: string) {
  const words = wordsOf(text);
  const parts = wordsOf(term);
  if (!parts.length) return false;
  return parts.every((part) =>
    words.some((word) => word.startsWith(part) || word.replace(/^#/, '').startsWith(part)),
  );
}

/** The heading and the excerpt of a doc passage, for the result row. */
const snippetOf = (passage?: DocPassage) =>
  passage ? [passage.heading, passage.excerpt].filter(Boolean).join(' · ') || undefined : undefined;

/** Shows the start of each word that a query word matches, with a subtle highlight. */
function Highlight({ text, term }: { text: string; term: string }) {
  const parts = wordsOf(term).sort((a, b) => b.length - a.length);
  if (!parts.length) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  let plain = 0;
  while (from < text.length) {
    // A match starts at the start of a word only.
    const start = from === 0 || /[^\p{L}\p{N}]/u.test(text[from - 1]);
    const part = start ? parts.find((item) => lower.startsWith(item, from)) : undefined;
    if (part) {
      if (from > plain) out.push(text.slice(plain, from));
      out.push(<mark key={from}>{text.slice(from, from + part.length)}</mark>);
      from += part.length;
      plain = from;
    } else from++;
  }
  if (plain < text.length) out.push(text.slice(plain));
  return <>{out}</>;
}

/** The icon of a recent chat, task or page: the identity mark of a chat or project. */
function RecentIcon({ place }: { place: RecentPlace }) {
  if (place.mark) return <IdentityMark kind={place.mark.kind} color={place.mark.color} />;
  if (place.kind === 'task') return <ListTodo />;
  if (place.kind === 'doc') return <FileText />;
  if (place.kind === 'project') return <Folder />;
  return <Clock />;
}

/** The content of one result row. Each part stays on one line. */
interface RowContent {
  icon: ReactNode;
  title: ReactNode;
  /** The place or the excerpt, such as "Atlas › atlas-web". */
  detail?: ReactNode;
  /** The kind or the shortcut, at the right side. */
  meta?: ReactNode;
  /** The full text, for the tooltip. */
  tooltip?: string;
  /** A button at the far right, such as Allow on the selected "Needs you" row. */
  action?: ReactNode;
  className?: string;
}

/**
 * The "Search or run…" trigger in the sidebar and the command palette that it opens.
 * The palette is a modal dialog in the center of the window. Its field is a combobox:
 * the arrow keys move the highlighted result, Enter opens it, and Escape closes the
 * palette and moves the focus back to the element that had it before.
 */
export function WorkspaceSearch({
  api,
  open,
  onOpenChange,
  triggerRef,
  trigger = true,
  markOf,
  projects,
  groups,
  sessions,
  onProject,
  onDoc,
  onMemory,
  onTask,
  onAsk,
  onRepository,
  onSession,
  actions = [],
  suggested = [],
  recent = [],
  needsYou = [],
  activity = {},
}: {
  /** True when the palette shows. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sidebar button that opens the palette. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** False: no Search row in the sidebar (a project window has a Search icon instead). */
  trigger?: boolean;
  /** The identity colors of chats, projects and code folders. */
  markOf?: SearchMarks;
  /** Commands that show in the results when they match the query. */
  actions?: SearchAction[];
  /** Commands that show with an empty query, under "Actions". */
  suggested?: SearchAction[];
  /** The last places, under "Recent" with an empty query. */
  recent?: RecentPlace[];
  /** The chats that wait for the user. They show first, under "Needs you", with an empty query. */
  needsYou?: RecentPlace[];
  /** Background state of open sessions, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
  /** Opens a docs page of a project. */
  onDoc?: (group: ProjectGroup, doc: ProjectDocMetadata) => void;
  /** Opens a memory topic of a project. */
  onMemory?: (group: ProjectGroup, entry: MemoryEntry) => void;
  /** Opens a task on the project board. */
  onTask?: (group: ProjectGroup, task: TrackerItem) => void;
  /** Starts a chat with the query as its first message. Mod+Enter runs it. */
  onAsk?: (prompt: string) => void;
  api: API;
  projects: Project[];
  groups: ProjectGroup[];
  sessions: Session[];
  onProject: (group: ProjectGroup) => void;
  onRepository: (repo: Project) => void;
  onSession: (session: Session) => void;
}) {
  const id = useId();
  const listId = `${id}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase();
  const matches = (text: string) => wordStartMatch(text, term);
  const [history, setHistory] = useState<{ session: Session; excerpt: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState(0);
  // The first result is active when the palette opens and after each change of the query, so
  // Enter opens it at once.
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [term, open]);
  // Each time the palette opens, it starts with an empty query.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  // The element that had the focus before the palette opened.
  const previousFocus = useRef<HTMLElement | null>(null);
  // True after the user opens a result. The result then controls the focus.
  const chose = useRef(false);
  // A layout effect runs before the dialog moves the focus into the palette.
  useLayoutEffect(() => {
    if (!open) return;
    chose.current = false;
    const current = document.activeElement;
    previousFocus.current =
      current instanceof HTMLElement && current !== document.body ? current : null;
  }, [open]);
  // With an empty query, the palette shows Needs you, Recent and Actions.
  const showStart =
    open && !term && (needsYou.length > 0 || recent.length > 0 || suggested.length > 0);
  // Full-text doc results, with the heading of the passage as a snippet.
  const [passages, setPassages] = useState<{ group: ProjectGroup; passage: DocPassage }[]>([]);
  useEffect(() => {
    setPassages([]);
    if (term.length < 2 || !onDoc) return;
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all(
        groups.map((group) =>
          Promise.resolve()
            .then(() =>
              typeof api.docsSearch === 'function' ? api.docsSearch(group.id, term, 8) : [],
            )
            .then((list) => list.map((passage) => ({ group, passage })))
            .catch(() => []),
        ),
      ).then((lists) => {
        if (live) setPassages(lists.flat());
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, term, groups]);
  // Transcripts stay cached by session and update time, so a refresh reads only changed
  // sessions. Failures, docs and tasks stay cached until the search is cleared.
  const transcripts = useRef(new Map<string, Transcript | 'failed'>());
  const docs = useRef(new Map<string, ProjectDocMetadata[]>());
  const memory = useRef(new Map<string, MemoryEntry[]>());
  const tasks = useRef(new Map<string, TrackerItem[]>());
  const [, setLoaded] = useState(0);
  const searching = term.length > 0;
  useEffect(() => {
    if (searching) return;
    for (const [key, value] of transcripts.current)
      if (value === 'failed') transcripts.current.delete(key);
    docs.current.clear();
    memory.current.clear();
    tasks.current.clear();
  }, [searching]);
  // Load the docs and tasks of each project once for each search.
  useEffect(() => {
    if (!searching) return;
    let live = true;
    for (const group of groups) {
      if (onDoc && !docs.current.has(group.id)) {
        docs.current.set(group.id, []);
        Promise.resolve()
          .then(() => api.docsMetadata(group.id))
          .then((pages) => {
            docs.current.set(group.id, pages);
            if (live) setLoaded((value) => value + 1);
          })
          .catch(() => {
            /* A project without docs gives no results. */
          });
      }
      if (onMemory && !memory.current.has(group.id) && typeof api.memoryEntries === 'function') {
        memory.current.set(group.id, []);
        Promise.resolve()
          .then(() => api.memoryEntries(group.id))
          .then((entries) => {
            memory.current.set(group.id, entries);
            if (live) setLoaded((value) => value + 1);
          })
          .catch(() => {
            /* A project without memory gives no results. */
          });
      }
      const connection = trackerConnection(group);
      if (onTask && connection && !tasks.current.has(group.id)) {
        tasks.current.set(group.id, []);
        Promise.resolve()
          .then(() => trackerClient(api, connection.provider).board(group.id))
          .then((board) => {
            tasks.current.set(group.id, board.items);
            if (live) setLoaded((value) => value + 1);
          })
          .catch(() => {
            /* A tracker that is not available gives no results. */
          });
      }
    }
    return () => {
      live = false;
    };
  }, [api, searching, groups]);
  // The session list is a new array after each refresh. Scan again only when a
  // session is added, removed, or updated.
  const sessionsKey = useMemo(
    () =>
      sessions.map((s) => `${s.hostId ?? ''}:${s.agent}:${s.id}:${s.updatedAt ?? ''}`).join('|'),
    [sessions],
  );
  const transcriptKey = (s: Session) => `${s.hostId ?? ''}:${s.agent}:${s.id}:${s.updatedAt ?? ''}`;
  const latestSessions = useRef(sessions);
  latestSessions.current = sessions;
  const scannedTerm = useRef('');
  useEffect(() => {
    let cancelled = false;
    // For a new query, remove the old hits. For a rescan of the same query, keep
    // the old hits on screen until the new scan is complete.
    const rescan = scannedTerm.current === term;
    scannedTerm.current = term;
    if (!rescan) {
      setHistory([]);
      setPartial(0);
    }
    setBusy(term.length >= 2);
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      let cursor = 0,
        truncated = 0;
      const results: { session: Session; excerpt: string }[] = [];
      const candidates = latestSessions.current.filter((s) => !s.id.startsWith('draft-'));
      const read = async (session: Session) => {
        const key = transcriptKey(session);
        const cached = transcripts.current.get(key);
        if (cached) return cached;
        try {
          const value = await sessionAPI(api, session).transcript(session.agent, session.id);
          transcripts.current.set(key, value);
          return value;
        } catch {
          transcripts.current.set(key, 'failed');
          return 'failed' as const;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(3, candidates.length) }, async () => {
          while (!cancelled && cursor < candidates.length) {
            const session = candidates[cursor++];
            const transcript = await read(session);
            if (cancelled) return;
            if (transcript === 'failed') continue;
            if (transcript.truncated) truncated++;
            const message = transcript.messages.find((m) =>
              m.text.toLocaleLowerCase().includes(term),
            );
            if (message) {
              const index = message.text.toLocaleLowerCase().indexOf(term);
              const start = Math.max(0, index - 50);
              results.push({
                session,
                excerpt:
                  (start ? '…' : '') +
                  message.text.slice(start, index + term.length + 100) +
                  (index + term.length + 100 < message.text.length ? '…' : ''),
              });
              if (!rescan) setHistory([...results]);
            }
          }
        }),
      );
      if (!cancelled) {
        setHistory(results);
        setBusy(false);
        setPartial(truncated);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, term, sessionsKey]);
  // Count failures from the cache, so the alert does not show again for each new query.
  const failed =
    term.length >= 2
      ? sessions.filter((s) => transcripts.current.get(transcriptKey(s)) === 'failed').length
      : 0;
  const projectMatches = term ? groups.filter((g) => matches(g.name)) : [];
  // Title matches first, then pages that the full-text search found. One row per page.
  const titleMatches = term
    ? groups.flatMap((group) =>
        (docs.current.get(group.id) || [])
          .filter((doc) => matches(doc.title))
          .map((doc) => ({ group, doc, snippet: undefined as string | undefined })),
      )
    : [];
  const docMatches = [
    ...titleMatches.map((match) => ({
      ...match,
      snippet: snippetOf(
        passages.find(
          (item) => item.group.id === match.group.id && item.passage.id === match.doc.id,
        )?.passage,
      ),
    })),
    ...passages
      .filter(
        ({ group, passage }, index, list) =>
          !titleMatches.some(
            (match) => match.group.id === group.id && match.doc.id === passage.id,
          ) &&
          list.findIndex((item) => item.group.id === group.id && item.passage.id === passage.id) ===
            index,
      )
      .map(({ group, passage }) => ({
        group,
        doc:
          (docs.current.get(group.id) || []).find((doc) => doc.id === passage.id) ||
          ({ id: passage.id, title: passage.title } as ProjectDocMetadata),
        snippet: snippetOf(passage),
      })),
  ];
  const taskMatches = term
    ? groups.flatMap((group) =>
        (tasks.current.get(group.id) || [])
          .filter((task) => matches(task.title + (task.number ? ' #' + task.number : '')))
          .map((task) => ({ group, task })),
      )
    : [];
  // One row for each memory topic whose name or facts match.
  const memoryMatches = term
    ? groups.flatMap((group) => {
        const topics = new Map<string, MemoryEntry[]>();
        for (const entry of memory.current.get(group.id) || [])
          if (matches(entry.topic + ' ' + entry.content))
            topics.set(entry.topic, [...(topics.get(entry.topic) || []), entry]);
        return [...topics.values()].map((entries) => ({ group, entry: entries[0], entries }));
      })
    : [];
  const repoMatches = term ? projects.filter((p) => matches(p.name)) : [];
  const sessionMatches = term
    ? sessions.filter((s) =>
        matches(
          [
            s.title,
            s.organization?.title,
            s.organization?.notes,
            s.organization?.collection,
            s.cwd,
          ].join(' '),
        ),
      )
    : [];
  // One row for each label: two actions with the same words are one result. Actions whose
  // label matches come before actions that match only through their keywords.
  const actionMatches = term
    ? actions
        .filter(
          (action, index, list) =>
            matches(action.label + ' ' + (action.keywords || '')) &&
            list.findIndex((item) => item.label === action.label) === index,
        )
        .sort((a, b) => Number(matches(b.label)) - Number(matches(a.label)))
    : [];
  const ask = term && onAsk ? query.trim() : '';
  const title = (s: Session) => s.organization?.title || s.title;
  const sessionKey = (s: Session) => s.hostId + ':' + s.agent + ':' + s.id;
  // One row for each session. A message match shows its excerpt in the session row.
  const excerpts = new Map(history.map((hit) => [sessionKey(hit.session), hit.excerpt]));
  const sessionResults = [
    ...sessionMatches,
    ...history
      .map((hit) => hit.session)
      .filter((session) => !sessionMatches.some((s) => sessionKey(s) === sessionKey(session))),
  ];
  const projectOf = (repo?: Project) =>
    repo ? groups.find((g) => g.repoIds.includes(repo.id))?.name : undefined;
  const options: SearchOption[] = showStart
    ? [
        ...needsYou.map((place) => ({ key: 'needs:' + place.key, open: place.open })),
        ...recent.map((place) => ({ key: 'recent:' + place.key, open: place.open })),
        ...suggested.map((action) => ({ key: 'suggested:' + action.key, open: action.run })),
      ]
    : [
        // The order of the groups: Chats, Tasks, Docs and memory, Projects, then Actions.
        ...sessionResults.map((s) => ({
          key: 'session:' + sessionKey(s),
          open: () => onSession(s),
        })),
        ...taskMatches.map(({ group, task }) => ({
          key: `task:${group.id}:${task.id}`,
          open: () => onTask?.(group, task),
        })),
        ...docMatches.map(({ group, doc }) => ({
          key: `doc:${group.id}:${doc.id}`,
          open: () => onDoc?.(group, doc),
        })),
        ...memoryMatches.map(({ group, entry }) => ({
          key: `memory:${group.id}:${entry.topic}`,
          open: () => onMemory?.(group, entry),
        })),
        ...projectMatches.map((g) => ({ key: 'project:' + g.id, open: () => onProject(g) })),
        ...repoMatches.map((p) => ({ key: 'repo:' + p.id, open: () => onRepository(p) })),
        // Commands come last, so Enter on a name opens the item, not a command.
        ...actionMatches.map((action) => ({ key: 'action:' + action.key, open: action.run })),
        ...(ask ? [{ key: 'ask', open: () => onAsk?.(ask) }] : []),
      ];
  /** Closes the palette, then opens the result. */
  function choose(option: SearchOption) {
    chose.current = true;
    onOpenChange(false);
    option.open();
  }
  const optionId = (key: string) => `${id}-${key.replace(/[^\w-]/g, '_')}`;
  const activeOption = options[active];
  useEffect(() => {
    if (activeOption)
      document.getElementById(optionId(activeOption.key))?.scrollIntoView({ block: 'nearest' });
  }, [activeOption?.key]);
  function row(key: string, content: RowContent) {
    const index = options.findIndex((item) => item.key === key);
    const rowId = optionId(key);
    return (
      <div
        key={key}
        id={rowId}
        role="option"
        aria-selected={index === active}
        aria-labelledby={`${rowId}-title`}
        aria-describedby={content.detail ? `${rowId}-detail` : undefined}
        tabIndex={-1}
        className={'search-option' + (content.className ? ' ' + content.className : '')}
        title={content.tooltip}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => setActive(index)}
        onClick={() => options[index] && choose(options[index])}
      >
        <span className="search-option-icon" aria-hidden="true">
          {content.icon}
        </span>
        <span id={`${rowId}-title`} className="search-option-title">
          {content.title}
        </span>
        {content.detail && (
          <span id={`${rowId}-detail`} className="search-option-detail">
            {content.detail}
          </span>
        )}
        {content.meta && <span className="search-option-meta">{content.meta}</span>}
        {content.action}
      </div>
    );
  }
  /** The project of a row at its right side: the project square and the name. */
  const placeToken = (place?: RecentPlace['place']) =>
    place && <IdentityToken kind="project" color={place.color} name={place.name} />;
  /** Allows the approval of the active "Needs you" row. True when it did. */
  function allowActive() {
    const place = activeOption?.key.startsWith('needs:')
      ? needsYou.find((item) => 'needs:' + item.key === activeOption.key)
      : undefined;
    if (!place?.allow) return false;
    chose.current = true;
    onOpenChange(false);
    place.allow();
    return true;
  }
  function group(name: string, label: string, rows: ReactNode) {
    return (
      <div role="group" aria-labelledby={`${id}-${name}`}>
        <h3 id={`${id}-${name}`} className="group-label">
          {label}
        </h3>
        {rows}
      </div>
    );
  }
  const kbd = (keys?: string) => keys && <kbd className="kbd">{keys}</kbd>;
  const total = options.length;
  // "Ask an agent" is always offered. It is not a match.
  const found = total - (ask ? 1 : 0);
  const shortTerm = term.length < 2;
  const expanded = !!term || showStart;
  const shortcut = shortcutLabel(['mod'], 'K');
  const askKeys = shortcutLabel(['mod'], '↵');
  return (
    <>
      {trigger && (
        <button
          ref={triggerRef}
          type="button"
          className="search-trigger"
          aria-label="Search or run a command"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          onClick={() => onOpenChange(true)}
        >
          <Search className="search-trigger-icon" aria-hidden="true" />
          <span className="search-trigger-label">Search</span>
          <kbd className="kbd search-kbd" aria-hidden="true">
            {shortcut}
          </kbd>
        </button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          layout="scroll"
          aria-modal="true"
          aria-describedby={undefined}
          className="command-palette top-[84px] max-h-[min(60vh,560px)] translate-y-0 sm:max-w-[600px]"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A result that moved the focus, for example to a dialog, keeps it.
            const current = document.activeElement;
            if (chose.current && current && current !== document.body) return;
            const target = previousFocus.current;
            if (target?.isConnected) target.focus();
          }}
        >
          <DialogTitle className="sr-only">Search or run a command</DialogTitle>
          <div className="command-palette-field">
            <Search className="command-palette-search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="command-palette-input"
              role="combobox"
              aria-label="Search or run a command"
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? optionId(activeOption.key) : undefined}
              placeholder="Search or run a command"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (!total) return;
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setActive((current) => (Math.max(current, 0) + step + total) % total);
                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  // Mod+Enter allows the selected approval, or turns the query into a new chat.
                  if (allowActive()) {
                    event.preventDefault();
                    return;
                  }
                  if (!ask) return;
                  event.preventDefault();
                  choose({ key: 'ask', open: () => onAsk?.(ask) });
                } else if (event.key === 'Enter') {
                  const target = activeOption || options[0];
                  if (!target) return;
                  event.preventDefault();
                  choose(target);
                }
              }}
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
              >
                <X />
              </Button>
            )}
          </div>
          {showStart ? (
            <section className="workspace-search-results" aria-label="Recent and actions">
              <div id={listId} role="listbox" aria-label="Recent and actions">
                {!!needsYou.length &&
                  group(
                    'needs',
                    'Needs you',
                    needsYou.map((place) =>
                      row('needs:' + place.key, {
                        icon: <RecentIcon place={place} />,
                        title: place.label,
                        meta: placeToken(place.place) || place.context,
                        tooltip: [place.label, place.context].filter(Boolean).join(' · '),
                        // Allow is the one primary action. It shows on the selected row.
                        action:
                          place.allow && activeOption?.key === 'needs:' + place.key ? (
                            <Button
                              size="xs"
                              className="search-allow"
                              aria-label={`Allow ${place.label}`}
                              aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={(event) => {
                                event.stopPropagation();
                                allowActive();
                              }}
                            >
                              Allow <span className="search-allow-key">{askKeys}</span>
                            </Button>
                          ) : undefined,
                      }),
                    ),
                  )}
                {!!recent.length &&
                  group(
                    'recent',
                    'Recent',
                    recent.map((place) =>
                      row('recent:' + place.key, {
                        icon: <RecentIcon place={place} />,
                        title: place.label,
                        meta: placeToken(place.place) || place.context,
                        tooltip: [place.label, place.context].filter(Boolean).join(' · '),
                      }),
                    ),
                  )}
                {!!suggested.length &&
                  group(
                    'suggested',
                    'Actions',
                    suggested.map((action) =>
                      row('suggested:' + action.key, {
                        icon: action.icon || <Zap />,
                        title: action.label,
                        meta: kbd(action.shortcut),
                        tooltip: action.label,
                      }),
                    ),
                  )}
              </div>
            </section>
          ) : term ? (
            <section className="workspace-search-results" aria-label="Search results">
              {/* No count: the rows show what was found. Only work in progress shows. */}
              <p role="status" className="search-status" hidden={!busy && !(shortTerm && !found)}>
                {shortTerm && !found
                  ? 'Type at least two characters to search message text.'
                  : busy
                    ? 'Searching chat messages…'
                    : ''}
              </p>
              <div id={listId} role="listbox" aria-label="Results">
                {!!sessionResults.length &&
                  group(
                    'sessions',
                    'Chats',
                    sessionResults.map((s) => {
                      const repo = sessionRepo(s, projects);
                      const found = excerpts.get(sessionKey(s));
                      // Skip an excerpt that only repeats the title.
                      const excerpt = found?.replace(/^…|…$/g, '') === title(s) ? undefined : found;
                      const live = activity[activityKey(s.agent, s.id)];
                      const state = s.organization?.archived
                        ? 'Archived'
                        : waitsForUser(live)
                          ? 'Waiting for you'
                          : live === 'running'
                            ? 'Working'
                            : relativeTime(s.updatedAt);
                      const where = [projectOf(repo), state].filter(Boolean).join(' · ');
                      return row('session:' + sessionKey(s), {
                        icon: markOf ? (
                          <IdentityMark kind="session" color={markOf.session(s)} />
                        ) : (
                          <MessageSquarePlus />
                        ),
                        title: (
                          <>
                            <Highlight text={title(s)} term={term} />
                            <ChatStatusGlyph session={s} live={live} />
                          </>
                        ),
                        detail: excerpt ? <Highlight text={excerpt} term={term} /> : where,
                        className: excerpt ? 'history-search-hit' : undefined,
                        tooltip: [title(s), where, excerpt].filter(Boolean).join('\n'),
                      });
                    }),
                  )}
                {!!taskMatches.length &&
                  group(
                    'tasks',
                    'Tasks',
                    taskMatches.map(({ group: owner, task }) => {
                      const label = `${task.number ? `#${task.number} ` : ''}${task.title}`;
                      return row(`task:${owner.id}:${task.id}`, {
                        icon: <ListTodo />,
                        title: <Highlight text={label} term={term} />,
                        detail: [owner.name, task.status].filter(Boolean).join(' · '),
                        tooltip: label,
                      });
                    }),
                  )}
                {!!(docMatches.length || memoryMatches.length) &&
                  group('docs', 'Docs and memory', [
                    ...docMatches.map(({ group: owner, doc, snippet }) =>
                      row(`doc:${owner.id}:${doc.id}`, {
                        icon: <FileText />,
                        title: <Highlight text={doc.title || 'Untitled'} term={term} />,
                        detail:
                          snippet && snippet !== doc.title ? (
                            <Highlight text={snippet} term={term} />
                          ) : (
                            `${owner.name} · Page`
                          ),
                        tooltip: [doc.title, owner.name].filter(Boolean).join(' · '),
                      }),
                    ),
                    ...memoryMatches.map(({ group: owner, entry, entries }) =>
                      row(`memory:${owner.id}:${entry.topic}`, {
                        icon: <Brain />,
                        title: <Highlight text={entry.topic} term={term} />,
                        detail: `${owner.name} · Memory · ${plural(entries.length, 'fact')}`,
                        tooltip: entries.map((item) => item.content).join('\n'),
                      }),
                    ),
                  ])}
                {!!(projectMatches.length || repoMatches.length) &&
                  group('projects', 'Projects', [
                    ...projectMatches.map((g) =>
                      row('project:' + g.id, {
                        icon: markOf ? (
                          <IdentityMark kind="project" color={markOf.project(g)} />
                        ) : (
                          <Folder />
                        ),
                        title: <Highlight text={g.name} term={term} />,
                        detail: plural(g.repoIds.length, 'code folder'),
                        tooltip: g.name,
                      }),
                    ),
                    ...repoMatches.map((p) =>
                      row('repo:' + p.id, {
                        icon: markOf ? (
                          <IdentityMark kind="repo" color={markOf.repo(p)} />
                        ) : (
                          <FolderGit2 />
                        ),
                        title: <Highlight text={p.name} term={term} />,
                        detail: [projectOf(p), 'Code folder'].filter(Boolean).join(' · '),
                        tooltip: p.path,
                      }),
                    ),
                  ])}
                {!!(actionMatches.length || ask) &&
                  group('actions', 'Actions', [
                    ...actionMatches.map((action) =>
                      row('action:' + action.key, {
                        icon: action.icon || <Zap />,
                        title: <Highlight text={action.label} term={term} />,
                        meta: kbd(action.shortcut),
                        tooltip: action.label,
                      }),
                    ),
                    ...(ask
                      ? [
                          row('ask', {
                            icon: <MessageSquarePlus />,
                            title: `Ask an agent: “${ask}”`,
                            tooltip: ask,
                          }),
                        ]
                      : []),
                  ])}
              </div>
              {!shortTerm && !busy && !found && <p className="search-status">No matches found.</p>}
              {!!failed && (
                <p role="alert" className="field-error search-error">
                  {plural(failed, 'chat')} could not be searched. Check the host connection and try
                  again.
                </p>
              )}
              {!!partial && (
                <p role="status" className="search-status">
                  For {plural(partial, 'long chat')}, the search used only the most recent messages.
                </p>
              )}
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
