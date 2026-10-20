import { useEffect, useRef, useState } from 'react';
import type { API, ProjectGroup } from '../types';
import { trackerConnection } from '../domain/tracker';
import { portfolioItems, portfolioRisks, type PortfolioProject } from '../domain/project-portfolio';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { errorMessage } from '../lib/errors';
export function ProjectPortfolio({ api }: { api: API }) {
  const [open, setOpen] = useState(false),
    [groups, setGroups] = useState<ProjectGroup[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [projects, setProjects] = useState<PortfolioProject[]>([]),
    [login, setLogin] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [at, setAt] = useState<number>();
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  async function load(fetchBoards: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const token = ++epoch.current;
    try {
      if (fetchBoards) {
        const value = await api.trackerPortfolio(selected);
        if (token === epoch.current) {
          setProjects(value);
          setAt(Date.now());
        }
      } else {
        const value = await api.snapshot();
        if (token === epoch.current) {
          setGroups(
            (value.groups || []).filter((group) => trackerConnection(group)?.provider === 'github'),
          );
          setSelected([]);
          setProjects([]);
        }
      }
    } catch (failure) {
      if (token === epoch.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (token === epoch.current) setBusy(false);
    }
  }
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Portfolio and personal work</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <p className="help-text">
            Combine up to 20 connected GitHub projects for review. Each item keeps its source
            project. This view does not create a local board or copy tasks.
          </p>
          <Button variant="outline" disabled={busy} onClick={() => void load(false)}>
            Choose connected projects
          </Button>
          {groups.map((group) => (
            <label key={group.id}>
              <input
                type="checkbox"
                checked={selected.includes(group.id)}
                disabled={busy || (!selected.includes(group.id) && selected.length >= 20)}
                onChange={(event) => {
                  setProjects([]);
                  setSelected(
                    event.target.checked
                      ? [...selected, group.id]
                      : selected.filter((id) => id !== group.id),
                  );
                }}
              />
              {group.name}
            </label>
          ))}
          <Button disabled={busy || !selected.length} onClick={() => void load(true)}>
            {busy ? 'Loading portfolio…' : 'Load selected projects'}
          </Button>
          <label className="form-label">
            Assigned GitHub login (optional)
            <Input
              aria-label="Assigned GitHub login"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          </label>
          {at && projects.length > 0 && (
            <p className="help-text">
              Snapshot: {new Date(at).toLocaleString()}. Past date fields are review hints, not
              inferred deadlines.
            </p>
          )}
          {projects.map((project) => (
            <div key={project.groupId}>
              {project.error ? (
                <p role="alert">
                  {groups.find((group) => group.id === project.groupId)?.name}: {project.error}
                </p>
              ) : (
                <p>
                  {project.board?.project.title}: {project.board?.items.length} visible tasks ·{' '}
                  {project.board?.restrictedItems || 0} restricted
                </p>
              )}
            </div>
          ))}
          {portfolioItems(projects, login).map(({ groupId, project, item }) => (
            <article key={`${groupId}:${item.id}`} className="grid gap-1 border-t pt-2">
              <a href={item.url || project.url} target="_blank" rel="noreferrer">
                {item.title}
              </a>
              <p className="help-text">
                {project.title} · {item.repository || 'No repository'} ·{' '}
                {item.status || 'No status'}
              </p>
              <p className="help-text">{portfolioRisks(item, at ?? 0).join(' · ')}</p>
            </article>
          ))}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
