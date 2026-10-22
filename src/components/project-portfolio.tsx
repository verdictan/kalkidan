import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { API, ProjectGroup } from '../types';
import { trackerConnection } from '../domain/tracker';
import {
  portfolioItems,
  portfolioRiskLabels,
  portfolioRisks,
  type PortfolioProject,
  type PortfolioRiskCode,
} from '../domain/project-portfolio';
import { plural } from '../domain/planning-labels';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { SegmentedControl } from './ui/segmented-control';
import { Hint } from './hint';
import { ErrorAlert, openTask, TaskTitle, FormSelect } from './planning-kit';
import { errorMessage } from '../lib/errors';

const portfolioLimit = 20;

/**
 * My work: the tasks of all connected projects in one list. "Me" is the GitHub account of the
 * gh command. Each task opens in its own project. Review hints are filter chips.
 */
export function ProjectPortfolio({ api, groups }: { api: API; groups: ProjectGroup[] }) {
  const connected = groups
    .filter((group) => trackerConnection(group)?.provider === 'github')
    .slice(0, portfolioLimit);
  const ids = connected.map((group) => group.id).join(',');
  const [projects, setProjects] = useState<PortfolioProject[]>([]),
    [login, setLogin] = useState(''),
    [who, setWho] = useState<'me' | 'all'>('me'),
    [project, setProject] = useState(''),
    [risks, setRisks] = useState<PortfolioRiskCode[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [at, setAt] = useState<number>();
  const [reload, setReload] = useState(0);
  const available = typeof api.trackerPortfolio === 'function';
  useEffect(() => {
    if (!available || !ids) return;
    let disposed = false;
    setBusy(true);
    setError('');
    void api
      .trackerPortfolio(ids.split(','))
      .then((value) => {
        if (disposed) return;
        setProjects(value);
        setAt(Date.now());
      })
      .catch((failure) => {
        if (!disposed) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, ids, available, reload]);
  // "Me" is the user account that the gh command signed in with.
  useEffect(() => {
    let disposed = false;
    void api
      .trackerOwners('github')
      .then((owners) => {
        const me = owners.find((owner) => owner.kind === 'user')?.login || '';
        if (!disposed) {
          setLogin(me);
          if (!me) setWho('all');
        }
      })
      .catch(() => {
        if (!disposed) setWho('all');
      });
    return () => {
      disposed = true;
    };
  }, [api]);

  if (!available) return null;
  if (!connected.length)
    return (
      <EmptyState compact title="No connected boards">
        Connect a GitHub Projects board to a project. Its tasks then show here.
      </EmptyState>
    );
  const name = (groupId: string) => groups.find((group) => group.id === groupId)?.name || 'Project';
  const all = portfolioItems(projects, who === 'me' ? login : '')
    .filter((row) => !project || row.groupId === project)
    .map((row) => ({ ...row, risks: portfolioRisks(row.item, at ?? 0) }));
  const counts = (Object.keys(portfolioRiskLabels) as PortfolioRiskCode[]).map((code) => ({
    code,
    count: all.filter((row) => row.risks.some((risk) => risk.code === code)).length,
  }));
  const rows = risks.length
    ? all.filter((row) => row.risks.some((risk) => risks.includes(risk.code)))
    : all;
  return (
    <section className="grid gap-3" aria-label="My work">
      <div className="flex flex-wrap items-center gap-2">
        {login && (
          <SegmentedControl
            label="Whose tasks"
            size="sm"
            value={who}
            onChange={setWho}
            options={[
              { value: 'me', label: `Assigned to me (${login})` },
              { value: 'all', label: 'Everyone' },
            ]}
          />
        )}
        {connected.length > 1 && (
          <FormSelect
            label="Project"
            size="sm"
            variant="filled"
            value={project}
            onChange={setProject}
            options={[
              { value: '', label: 'All projects' },
              ...connected.map((group) => ({ value: group.id, label: group.name })),
            ]}
          />
        )}
        {counts
          .filter((row) => row.count > 0 || risks.includes(row.code))
          .map((row) => (
            <Button
              key={row.code}
              size="xs"
              variant="chip"
              aria-pressed={risks.includes(row.code)}
              onClick={() =>
                setRisks(
                  risks.includes(row.code)
                    ? risks.filter((code) => code !== row.code)
                    : [...risks, row.code],
                )
              }
            >
              {portfolioRiskLabels[row.code]} · {row.count}
            </Button>
          ))}
        <span className="ml-auto text-xs text-muted-foreground">{plural(rows.length, 'task')}</span>
        <Hint label="Load again">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Load again"
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw size={16} className={busy ? 'animate-spin' : undefined} />
          </Button>
        </Hint>
      </div>
      <ErrorAlert>{error}</ErrorAlert>
      {projects
        .filter((value) => value.error)
        .map((value) => (
          <ErrorAlert key={value.groupId}>
            {name(value.groupId)}: {value.error}
          </ErrorAlert>
        ))}
      {busy && !projects.length && <p className="form-help">Loading tasks…</p>}
      {!busy && at && !rows.length && (
        <EmptyState compact>
          {risks.length || project || who === 'me'
            ? 'No tasks match. Clear a filter to see more tasks.'
            : 'The connected boards have no tasks.'}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div>
          {rows.map(({ groupId, item, risks: notes }) => (
            <div key={`${groupId}:${item.id}`} className="list-row row-hover px-2">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium">
                  <TaskTitle title={item.title} onOpen={() => openTask(groupId, item.id)} />
                </span>
                <span className="truncate text-xs leading-4 text-muted-foreground">
                  {name(groupId)} · {item.repository || 'No repository'} ·{' '}
                  {item.status || 'No status'}
                </span>
              </div>
              {notes.length > 0 && (
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {notes.map((risk) => (
                    <Badge key={risk.code + risk.label} variant="warning" size="sm">
                      {risk.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {at && (
        <p className="form-help">
          Loaded {new Date(at).toLocaleString()}. A date in the past is a hint, not a deadline.
        </p>
      )}
    </section>
  );
}
