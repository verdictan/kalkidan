import { useEffect, useState } from 'react';
import { sessionAPI } from '../lib/remote-api';
import type { API, Project, ProjectGroup, Session } from '../types';
import { Button } from './ui/button';

export function WorkspaceSearch({
  api,
  query,
  projects,
  groups,
  sessions,
  onProject,
  onRepository,
  onSession,
}: {
  api: API;
  query: string;
  projects: Project[];
  groups: ProjectGroup[];
  sessions: Session[];
  onProject: (group: ProjectGroup) => void;
  onRepository: (repo: Project) => void;
  onSession: (session: Session) => void;
}) {
  const term = query.trim().toLocaleLowerCase();
  const matches = (text: string) => text.toLocaleLowerCase().includes(term);
  const [history, setHistory] = useState<{ session: Session; excerpt: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState('');
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setWarning('');
    setBusy(term.length >= 2);
    if (term.length < 2) return;
    const timer = setTimeout(async () => {
      let cursor = 0,
        failed = 0,
        partial = 0;
      const results: { session: Session; excerpt: string }[] = [];
      const candidates = sessions.filter((s) => !s.id.startsWith('draft-'));
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
              if (transcript.truncated) partial++;
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
                setHistory([...results]);
              }
            } catch {
              failed++;
            }
          }
        }),
      );
      if (!cancelled) {
        setBusy(false);
        setWarning(
          [
            failed
              ? `${failed} conversations could not be searched. Check the host connection and try again.`
              : '',
            partial
              ? `${partial} long conversations were searched only within their most recent messages.`
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, term, sessions]);
  const projectMatches = groups.filter((g) => matches(g.name));
  const repoMatches = projects.filter((p) => matches(p.name + ' ' + p.path));
  const sessionMatches = sessions.filter((s) =>
    matches(
      [
        s.title,
        s.organization?.title,
        s.organization?.notes,
        s.organization?.collection,
        s.cwd,
      ].join(' '),
    ),
  );
  const title = (s: Session) => s.organization?.title || s.title;
  return (
    <section className="workspace-search-results" aria-label="Search results">
      <p role="status" className="text-xs text-muted-foreground px-2 py-2">
        {busy
          ? 'Searching chat history…'
          : `${projectMatches.length + repoMatches.length + sessionMatches.length + history.length} matches`}
      </p>
      {!!projectMatches.length && (
        <>
          <h3>Projects</h3>
          {projectMatches.map((g) => (
            <Button key={g.id} variant="ghost" onClick={() => onProject(g)}>
              {g.name}
            </Button>
          ))}
        </>
      )}
      {!!repoMatches.length && (
        <>
          <h3>Repositories</h3>
          {repoMatches.map((p) => (
            <Button key={p.id} variant="ghost" onClick={() => onRepository(p)} title={p.path}>
              {p.name}
            </Button>
          ))}
        </>
      )}
      {!!sessionMatches.length && (
        <>
          <h3>Sessions</h3>
          {sessionMatches.map((s) => (
            <Button
              key={s.hostId + ':' + s.agent + ':' + s.id}
              variant="ghost"
              onClick={() => onSession(s)}
            >
              {title(s)}
              {s.organization?.archived ? ' · Archived' : ''}
            </Button>
          ))}
        </>
      )}
      {!!history.length && (
        <>
          <h3>Chat history</h3>
          {history.map(({ session, excerpt }) => (
            <Button
              key={session.hostId + ':' + session.agent + ':' + session.id}
              variant="ghost"
              className="history-search-hit"
              onClick={() => onSession(session)}
            >
              <span>{title(session)}</span>
              <span className="text-xs text-muted-foreground">{excerpt}</span>
            </Button>
          ))}
        </>
      )}
      {term.length < 2 && (
        <p className="p-2 text-xs text-muted-foreground">
          Type at least two characters to search message text.
        </p>
      )}
      {!busy &&
        !projectMatches.length &&
        !repoMatches.length &&
        !sessionMatches.length &&
        !history.length && <p className="p-2 text-sm text-muted-foreground">No matches found.</p>}
      {warning && (
        <p role="alert" className="p-2 text-xs text-muted-foreground">
          {warning}
        </p>
      )}
    </section>
  );
}
