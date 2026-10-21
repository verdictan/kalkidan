import { useTracker } from '../hooks/use-tracker';
import { useEffect, useState } from 'react';
import type { API, TrackerOwner, TrackerProject } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { Choice } from './choice';
import { SegmentedControl } from './ui/segmented-control';
import { SearchInput } from './ui/search-input';
import { EmptyState } from './ui/empty-state';
import { cn } from '../lib/utils';

/** The name of the board on the tracker side, for example "GitHub Projects board". */
export function boardLabel(providerName: string) {
  return providerName === 'GitHub' ? 'GitHub Projects board' : `${providerName} board`;
}

export function TrackerProjectPicker({
  api,
  provider = 'github',
  defaultTitle,
  value,
  onChange,
  onBusy,
  autoFocus = true,
}: {
  api: API;
  provider?: string;
  defaultTitle: string;
  value: string;
  onChange: (url: string) => void;
  onBusy: (busy: boolean) => void;
  /** Puts the focus in the search field when the picker shows, so the user can type at once. */
  autoFocus?: boolean;
}) {
  const { client, name: providerName, descriptor } = useTracker(api, provider);
  const board = boardLabel(providerName);
  const [mode, setMode] = useState('pick');
  const [owners, setOwners] = useState<TrackerOwner[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState(defaultTitle);
  const [titleEdited, setTitleEdited] = useState(false);
  useEffect(() => {
    if (!titleEdited) setTitle(defaultTitle);
  }, [defaultTitle, titleEdited]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const owner = owners.find((o) => o.id === ownerId);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    client
      .owners()
      .then((result) => {
        if (active) {
          setOwners(result);
          setOwnerId((current) =>
            result.some((o) => o.id === current) ? current : result[0]?.id || '',
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, revision]);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    setLoading(true);
    setProjects([]);
    setError('');
    client
      .projects(owner)
      .then((result) => {
        if (active) setProjects(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, owner, revision]);
  async function create() {
    if (!owner || creating) return;
    setCreating(true);
    onBusy(true);
    setError('');
    try {
      const project = await client.createProject(owner, title);
      setProjects((current) => [project, ...current]);
      setQuery('');
      onChange(project.url);
      setMode('pick');
      setNotice(
        `Created “${project.title}” on ${providerName}. Finish this dialog to connect it to ${defaultTitle}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
      onBusy(false);
    }
  }
  return (
    <div className="grid gap-3">
      <SegmentedControl
        size="sm"
        className="justify-self-start"
        label="Board connection method"
        value={mode}
        onChange={(next) => {
          setMode(next);
          onChange('');
          setNotice('');
        }}
        options={[
          { value: 'pick', label: 'Choose existing', disabled: creating },
          ...(descriptor?.capabilities.createProject
            ? [{ value: 'create', label: 'Create new', disabled: creating }]
            : []),
          { value: 'url', label: 'Use URL', disabled: creating },
        ]}
      />
      {mode !== 'url' && (
        <Choice
          className="w-full"
          label={`${providerName} owner`}
          disabled={loading || creating}
          value={ownerId}
          onChange={(id) => {
            setOwnerId(id);
            onChange('');
            setNotice('');
          }}
          options={owners.map((o) => ({
            value: o.id,
            label: `${o.login}${o.kind === 'user' ? ' (personal)' : ''}`,
          }))}
        />
      )}
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              size="sm"
              disabled={creating}
              onClick={() => setRevision((n) => n + 1)}
            >
              Load boards again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {mode === 'url' ? (
        <Input
          autoFocus
          aria-label={`${board} URL`}
          placeholder="Board URL"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : mode === 'create' ? (
        <>
          <Input
            autoFocus
            aria-label={`New ${board} name`}
            maxLength={256}
            value={title}
            disabled={creating}
            onChange={(e) => {
              setTitleEdited(true);
              setTitle(e.target.value);
            }}
            placeholder="Board name"
          />
          <p className="form-help m-0">
            Creates a {board} owned by {owner?.login || 'the selected account'}. The permissions of
            an organization can prevent this.
          </p>
          <Button
            variant="outline"
            className="justify-self-end"
            disabled={!owner || loading || creating || !title.trim()}
            onClick={() => void create()}
          >
            {creating ? 'Creating…' : `Create ${board}`}
          </Button>
        </>
      ) : (
        <>
          <SearchInput
            autoFocus={autoFocus}
            aria-label={`Search ${board}s`}
            placeholder={`Search ${board}s…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="list-box" role="group" aria-label={`Available ${board}s`}>
            {loading ? (
              <EmptyState compact>Loading boards…</EmptyState>
            ) : (
              projects
                .filter((p) => `${p.title} ${p.number}`.toLowerCase().includes(query.toLowerCase()))
                .map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    aria-pressed={value === project.url}
                    aria-label={
                      project.number ? `${project.title} #${project.number}` : project.title
                    }
                    className={cn(
                      'list-box-row text-sm',
                      value === project.url && 'text-foreground',
                    )}
                    onClick={() => onChange(project.url)}
                  >
                    <span className="min-w-0 flex-1 truncate" title={project.title}>
                      {project.title}
                    </span>
                    {project.number ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        #{project.number}
                      </span>
                    ) : null}
                  </button>
                ))
            )}
            {!loading &&
              !error &&
              !projects.some((p) =>
                `${p.title} ${p.number}`.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <EmptyState compact>
                  {query
                    ? 'No matching boards.'
                    : descriptor?.capabilities.createProject
                      ? 'No open boards yet. Select Create new to make one.'
                      : 'No open boards yet.'}
                </EmptyState>
              )}
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
