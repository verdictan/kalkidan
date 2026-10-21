import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Clock, FileText, Folder, FolderGit2, LayoutGrid, MessagesSquare, X } from 'lucide-react';
import { agentLabel } from '../config/agents';
import { trackerConnection, type TrackerItem } from '../domain/tracker';
import type { DocPassage, ProjectDocMetadata } from '../domain/docs';
import { sessionAPI } from '../lib/remote-api';
import { sessionRepo } from '../lib/session-repository';
import { trackerClient } from '../lib/tracker-client';
import { plural, shortcutLabel } from '../lib/platform';
import type { API, Project, ProjectGroup, Session } from '../types';
import { relativeTime } from '../lib/relative-time';
import { ActivityDot, activityKey, type SessionActivityState } from './activity-dot';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { SearchInput } from './ui/search-input';

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
  run: () => void;
}

/** A place that the user opened before, for "Recent" in an empty search. */
export interface RecentPlace {
  key: string;
  label: string;
  /** The project or agent, shown after the label. */
  context?: string;
  kind: 'home' | 'sessions' | 'project' | 'repository' | 'conversation';
  agent?: string;
  open: () => void;
}

/** The heading and the excerpt of a doc passage, for the result row. */
const snippetOf = (passage?: DocPassage) =>
  passage ? [passage.heading, passage.excerpt].filter(Boolean).join(' · ') || undefined : undefined;

/** Shows each match of `term` in `text` with a subtle highlight. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let index = lower.indexOf(term); index >= 0; index = lower.indexOf(term, from)) {
    if (index > from) parts.push(text.slice(from, index));
    parts.push(<mark key={index}>{text.slice(index, index + term.length)}</mark>);
    from = index + term.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

/**
 * The sidebar search field and its results. Without a query, it shows `children`
 * (the project tree). The field is a combobox: arrow keys move the highlighted
 * result, Enter opens it, and Escape clears the query.
 */
export function WorkspaceSearch({
  api,
  inputRef,
  query,
  onQueryChange,
  projects,
  groups,
  sessions,
  onProject,
  onDoc,
  onTask,
  onRepository,
  onSession,
  actions = [],
  suggested = [],
  recent = [],
  activity = {},
  children,
}: {
  /** Commands that show in the results when they match the query. */
  actions?: SearchAction[];
  /** Commands that show with an empty query, under "Suggested". */
  suggested?: SearchAction[];
  /** The last places, under "Recent" with an empty query. */
  recent?: RecentPlace[];
  /** Background state of open sessions, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
  /** Opens a docs page of a project. */
  onDoc?: (group: ProjectGroup, doc: ProjectDocMetadata) => void;
  /** Opens a task on the project board. */
  onTask?: (group: ProjectGroup, task: TrackerItem) => void;
  api: API;
  inputRef?: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  projects: Project[];
  groups: ProjectGroup[];
  sessions: Session[];
  onProject: (group: ProjectGroup) => void;
  onRepository: (repo: Project) => void;
  onSession: (session: Session) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const listId = `${id}-results`;
  const term = query.trim().toLocaleLowerCase();
  const matches = (text: string) => text.toLocaleLowerCase().includes(term);
  const [history, setHistory] = useState<{ session: Session; excerpt: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState(0);
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [term]);
  // With the focus in an empty field, the panel shows Recent and Suggested.
  const [focused, setFocused] = useState(false);
  const showStart = focused && !term && (recent.length > 0 || suggested.length > 0);
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
  const tasks = useRef(new Map<string, TrackerItem[]>());
  const [, setLoaded] = useState(0);
  const searching = term.length > 0;
  useEffect(() => {
    if (searching) return;
    for (const [key, value] of transcripts.current)
      if (value === 'failed') transcripts.current.delete(key);
    docs.current.clear();
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
  const repoMatches = term ? projects.filter((p) => matches(p.name + ' ' + p.path)) : [];
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
  const actionMatches = term
    ? actions.filter((action) => matches(action.label + ' ' + (action.keywords || '')))
    : [];
  const title = (s: Session) => s.organization?.title || s.title;
  const sessionKey = (s: Session) => s.hostId + ':' + s.agent + ':' + s.id;
  // One row for each session. A message match adds an excerpt under the session row.
  const excerpts = new Map(history.map((hit) => [sessionKey(hit.session), hit.excerpt]));
  const sessionResults = [
    ...sessionMatches,
    ...history
      .map((hit) => hit.session)
      .filter((session) => !sessionMatches.some((s) => sessionKey(s) === sessionKey(session))),
  ];
  const projectOf = (repo?: Project) =>
    repo ? groups.find((g) => g.repoIds.includes(repo.id))?.name : undefined;
  const context = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' › ');
  const startOptions: SearchOption[] = showStart
    ? [
        ...recent.map((place) => ({
          key: 'recent:' + place.key,
          open: () => {
            place.open();
            inputRef?.current?.blur();
          },
        })),
        ...suggested.map((action) => ({
          key: 'suggested:' + action.key,
          open: () => {
            action.run();
            inputRef?.current?.blur();
          },
        })),
      ]
    : [];
  const options: SearchOption[] = showStart
    ? startOptions
    : [
        ...projectMatches.map((g) => ({ key: 'project:' + g.id, open: () => onProject(g) })),
        ...repoMatches.map((p) => ({ key: 'repo:' + p.id, open: () => onRepository(p) })),
        ...sessionResults.map((s) => ({
          key: 'session:' + sessionKey(s),
          open: () => onSession(s),
        })),
        ...docMatches.map(({ group, doc }) => ({
          key: `doc:${group.id}:${doc.id}`,
          open: () => onDoc?.(group, doc),
        })),
        ...taskMatches.map(({ group, task }) => ({
          key: `task:${group.id}:${task.id}`,
          open: () => onTask?.(group, task),
        })),
        // Commands come last, so Enter on a name opens the item, not a command.
        ...actionMatches.map((action) => ({
          key: 'action:' + action.key,
          open: () => {
            onQueryChange('');
            action.run();
          },
        })),
      ];
  const optionId = (key: string) => `${id}-${key.replace(/[^\w-]/g, '_')}`;
  const activeOption = options[active];
  useEffect(() => {
    if (activeOption)
      document.getElementById(optionId(activeOption.key))?.scrollIntoView({ block: 'nearest' });
  }, [activeOption?.key]);
  function option(key: string, content: ReactNode, props: { className?: string; title?: string }) {
    const index = options.findIndex((item) => item.key === key);
    return (
      <div
        key={key}
        id={optionId(key)}
        role="option"
        aria-selected={index === active}
        tabIndex={-1}
        className={'search-option' + (props.className ? ' ' + props.className : '')}
        title={props.title}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => setActive(index)}
        onClick={() => options[index]?.open()}
      >
        {content}
      </div>
    );
  }
  const total = options.length;
  const shortTerm = term.length < 2;
  return (
    <>
      <div className="search">
        <SearchInput
          ref={inputRef}
          variant="filled"
          style={{ paddingRight: query ? 32 : 44 }}
          role="combobox"
          aria-label="Search projects and chats"
          aria-expanded={!!term || showStart}
          aria-controls={term || showStart ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeOption.key) : undefined}
          placeholder="Search or run…"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!total) return;
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current) =>
                current < 0 && step < 0 ? total - 1 : (current + step + total) % total,
              );
            } else if (event.key === 'Enter') {
              const target = activeOption || options[0];
              if (!target) return;
              event.preventDefault();
              target.open();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              if (query) onQueryChange('');
              else event.currentTarget.blur();
            } else if (event.key === 'Tab' && showStart) setFocused(false);
          }}
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange('');
              inputRef?.current?.focus();
            }}
          >
            <X />
          </Button>
        ) : (
          <kbd className="kbd search-kbd">{shortcutLabel(['mod'], 'K')}</kbd>
        )}
      </div>
      {showStart ? (
        <section className="workspace-search-results" aria-label="Recent and suggested">
          <div id={listId} role="listbox" aria-label="Recent and suggested">
            {!!recent.length && (
              <div role="group" aria-labelledby={`${id}-recent`}>
                <h3 id={`${id}-recent`} className="sidebar-label">
                  Recent
                </h3>
                {recent.map((place) =>
                  option(
                    'recent:' + place.key,
                    <span className="search-option-action">
                      <span className="search-option-icon" aria-hidden="true">
                        {place.kind === 'conversation' && place.agent ? (
                          <AgentIcon agent={place.agent} className="size-3.5" />
                        ) : place.kind === 'repository' ? (
                          <FolderGit2 />
                        ) : place.kind === 'sessions' ? (
                          <MessagesSquare />
                        ) : place.kind === 'project' && place.label === 'Docs' ? (
                          <FileText />
                        ) : place.kind === 'project' ? (
                          <Folder />
                        ) : place.kind === 'home' ? (
                          <LayoutGrid />
                        ) : (
                          <Clock />
                        )}
                      </span>
                      <span className="search-option-title">{place.label}</span>
                      {place.context && (
                        <span className="search-option-context">{place.context}</span>
                      )}
                    </span>,
                    { title: [place.label, place.context].filter(Boolean).join(' · ') },
                  ),
                )}
              </div>
            )}
            {!!suggested.length && (
              <div role="group" aria-labelledby={`${id}-suggested`}>
                <h3 id={`${id}-suggested`} className="sidebar-label">
                  Suggested
                </h3>
                {suggested.map((action) =>
                  option(
                    'suggested:' + action.key,
                    <span className="search-option-action">
                      <span className="search-option-title">{action.label}</span>
                      {action.shortcut && <kbd className="kbd">{action.shortcut}</kbd>}
                    </span>,
                    { title: action.label },
                  ),
                )}
              </div>
            )}
          </div>
          <p className="search-status">Type to search projects, chats, docs, tasks and actions.</p>
        </section>
      ) : term ? (
        <section className="workspace-search-results" aria-label="Search results">
          <p role="status" className="search-status">
            {shortTerm && !total
              ? 'Type at least two characters to search message text.'
              : busy && !total
                ? 'Searching chat messages…'
                : plural(total, 'match', 'matches') + (busy ? ' · Searching chat messages…' : '')}
          </p>
          <div id={listId} role="listbox" aria-label="Results">
            {!!projectMatches.length && (
              <div role="group" aria-labelledby={`${id}-projects`}>
                <h3 id={`${id}-projects`} className="sidebar-label">
                  Projects
                </h3>
                {projectMatches.map((g) =>
                  option('project:' + g.id, <Highlight text={g.name} term={term} />, {
                    title: g.name,
                  }),
                )}
              </div>
            )}
            {!!repoMatches.length && (
              <div role="group" aria-labelledby={`${id}-repositories`}>
                <h3 id={`${id}-repositories`} className="sidebar-label">
                  Code folders
                </h3>
                {repoMatches.map((p) =>
                  option(
                    'repo:' + p.id,
                    <>
                      <span className="search-option-title">
                        <Highlight text={p.name} term={term} />
                      </span>
                      {projectOf(p) && (
                        <span className="search-option-context">{projectOf(p)}</span>
                      )}
                    </>,
                    { title: p.path },
                  ),
                )}
              </div>
            )}
            {!!sessionResults.length && (
              <div role="group" aria-labelledby={`${id}-sessions`}>
                <h3 id={`${id}-sessions`} className="sidebar-label">
                  Chats
                </h3>
                {sessionResults.map((s) => {
                  const repo = sessionRepo(s, projects);
                  const found = excerpts.get(sessionKey(s));
                  // Skip an excerpt that only repeats the title.
                  const excerpt = found?.replace(/^…|…$/g, '') === title(s) ? undefined : found;
                  const where = context(projectOf(repo), repo?.name);
                  const when = relativeTime(s.updatedAt);
                  return option(
                    'session:' + sessionKey(s),
                    <>
                      <span className="search-option-title">
                        <Highlight text={title(s)} term={term} />
                        {s.organization?.archived ? ' · Archived' : ''}
                        <ActivityDot state={activity[activityKey(s.agent, s.id)]} />
                      </span>
                      <span className="search-option-context search-option-agent">
                        <AgentIcon agent={s.agent} className="size-3" />
                        {[agentLabel(s.agent), when, where].filter(Boolean).join(' · ')}
                      </span>
                      {excerpt && (
                        <span className="search-option-excerpt">
                          <Highlight text={excerpt} term={term} />
                        </span>
                      )}
                    </>,
                    { className: excerpt ? 'history-search-hit' : undefined, title: title(s) },
                  );
                })}
              </div>
            )}
            {!!docMatches.length && (
              <div role="group" aria-labelledby={`${id}-docs`}>
                <h3 id={`${id}-docs`} className="sidebar-label">
                  Docs
                </h3>
                {docMatches.map(({ group, doc, snippet }) =>
                  option(
                    `doc:${group.id}:${doc.id}`,
                    <>
                      <span className="search-option-title">
                        <Highlight text={doc.title || 'Untitled'} term={term} />
                      </span>
                      <span className="search-option-context">{group.name}</span>
                      {snippet && snippet !== doc.title && (
                        <span className="search-option-excerpt">
                          <Highlight text={snippet} term={term} />
                        </span>
                      )}
                    </>,
                    { title: doc.title },
                  ),
                )}
              </div>
            )}
            {!!taskMatches.length && (
              <div role="group" aria-labelledby={`${id}-tasks`}>
                <h3 id={`${id}-tasks`} className="sidebar-label">
                  Tasks
                </h3>
                {taskMatches.map(({ group, task }) =>
                  option(
                    `task:${group.id}:${task.id}`,
                    <>
                      <span className="search-option-title">
                        <Highlight text={task.title} term={term} />
                      </span>
                      <span className="search-option-context">
                        {context(group.name, task.number ? '#' + task.number : undefined)}
                      </span>
                    </>,
                    { title: task.title },
                  ),
                )}
              </div>
            )}
            {!!actionMatches.length && (
              <div role="group" aria-labelledby={`${id}-actions`}>
                <h3 id={`${id}-actions`} className="sidebar-label">
                  Actions
                </h3>
                {actionMatches.map((action) =>
                  option(
                    'action:' + action.key,
                    <span className="search-option-action">
                      <span className="search-option-title">
                        <Highlight text={action.label} term={term} />
                      </span>
                      {action.shortcut && <kbd className="kbd">{action.shortcut}</kbd>}
                    </span>,
                    { title: action.label },
                  ),
                )}
              </div>
            )}
          </div>
          {!shortTerm && !busy && !total && <p className="search-status">No matches found.</p>}
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
      ) : (
        children
      )}
    </>
  );
}
