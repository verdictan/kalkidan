import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { sessionAPI } from '../lib/remote-api';
import { plural, shortcutLabel } from '../lib/platform';
import type { API, Project, ProjectGroup, Session } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface SearchOption {
  key: string;
  open: () => void;
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
  onRepository,
  onSession,
  children,
}: {
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
  const [failed, setFailed] = useState(0);
  const [partial, setPartial] = useState(0);
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [term]);
  // The session list is a new array after each refresh. Scan again only when a
  // session is added, removed, or updated.
  const sessionsKey = useMemo(
    () =>
      sessions.map((s) => `${s.hostId ?? ''}:${s.agent}:${s.id}:${s.updatedAt ?? ''}`).join('|'),
    [sessions],
  );
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
      setFailed(0);
      setPartial(0);
    }
    setBusy(term.length >= 2);
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      let cursor = 0,
        failures = 0,
        truncated = 0;
      const results: { session: Session; excerpt: string }[] = [];
      const candidates = latestSessions.current.filter((s) => !s.id.startsWith('draft-'));
      await Promise.all(
        Array.from({ length: Math.min(3, candidates.length) }, async () => {
          while (!cancelled && cursor < candidates.length) {
            const session = candidates[cursor++];
            try {
              const transcript = await sessionAPI(api, session).transcript(
                session.agent,
                session.id,
              );
              if (cancelled) return;
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
            } catch {
              failures++;
            }
          }
        }),
      );
      if (!cancelled) {
        setHistory(results);
        setBusy(false);
        setFailed(failures);
        setPartial(truncated);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, term, sessionsKey]);
  const projectMatches = term ? groups.filter((g) => matches(g.name)) : [];
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
  const title = (s: Session) => s.organization?.title || s.title;
  const sessionKey = (s: Session) => s.hostId + ':' + s.agent + ':' + s.id;
  const options: SearchOption[] = [
    ...projectMatches.map((g) => ({ key: 'project:' + g.id, open: () => onProject(g) })),
    ...repoMatches.map((p) => ({ key: 'repo:' + p.id, open: () => onRepository(p) })),
    ...sessionMatches.map((s) => ({ key: 'session:' + sessionKey(s), open: () => onSession(s) })),
    ...history.map(({ session }) => ({
      key: 'message:' + sessionKey(session),
      open: () => onSession(session),
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
        <Search size={16} />
        <Input
          ref={inputRef}
          role="combobox"
          aria-label="Search projects and sessions"
          aria-expanded={!!term}
          aria-controls={term ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeOption.key) : undefined}
          placeholder="Search…"
          value={query}
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
            }
          }}
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange('');
              inputRef?.current?.focus();
            }}
          >
            <X size={14} />
          </Button>
        ) : (
          <kbd>{shortcutLabel(['mod'], 'K')}</kbd>
        )}
      </div>
      {term ? (
        <section className="workspace-search-results" aria-label="Search results">
          <p role="status" className="text-xs text-muted-foreground px-2 py-2">
            {shortTerm && !total
              ? 'Type at least two characters to search message text.'
              : busy && !total
                ? 'Searching session messages…'
                : plural(total, 'match', 'matches') +
                  (busy ? ' · Searching session messages…' : '')}
          </p>
          <div id={listId} role="listbox" aria-label="Results">
            {!!projectMatches.length && (
              <div role="group" aria-labelledby={`${id}-projects`}>
                <h3 id={`${id}-projects`}>Projects</h3>
                {projectMatches.map((g) => option('project:' + g.id, g.name, {}))}
              </div>
            )}
            {!!repoMatches.length && (
              <div role="group" aria-labelledby={`${id}-repositories`}>
                <h3 id={`${id}-repositories`}>Repositories</h3>
                {repoMatches.map((p) => option('repo:' + p.id, p.name, { title: p.path }))}
              </div>
            )}
            {!!sessionMatches.length && (
              <div role="group" aria-labelledby={`${id}-sessions`}>
                <h3 id={`${id}-sessions`}>Sessions</h3>
                {sessionMatches.map((s) =>
                  option(
                    'session:' + sessionKey(s),
                    <>
                      {title(s)}
                      {s.organization?.archived ? ' · Archived' : ''}
                    </>,
                    {},
                  ),
                )}
              </div>
            )}
            {!!history.length && (
              <div role="group" aria-labelledby={`${id}-messages`}>
                <h3 id={`${id}-messages`}>Session messages</h3>
                {history.map(({ session, excerpt }) =>
                  option(
                    'message:' + sessionKey(session),
                    <>
                      <span>{title(session)}</span>
                      <span className="text-xs text-muted-foreground">{excerpt}</span>
                    </>,
                    { className: 'history-search-hit' },
                  ),
                )}
              </div>
            )}
          </div>
          {!shortTerm && !busy && !total && (
            <p className="p-2 text-sm text-muted-foreground">No matches found.</p>
          )}
          {!!failed && (
            <p role="alert" className="search-error">
              {plural(failed, 'session')} could not be searched. Check the host connection and try
              again.
            </p>
          )}
          {!!partial && (
            <p role="status" className="p-2 text-xs text-muted-foreground">
              For {plural(partial, 'long session')}, the search used only the most recent messages.
            </p>
          )}
        </section>
      ) : (
        children
      )}
    </>
  );
}
