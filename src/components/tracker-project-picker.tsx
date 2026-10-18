import { useTracker } from '../hooks/use-tracker';
import { useEffect, useState } from 'react';
import type { API, TrackerOwner, TrackerProject } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { Choice } from './choice';

export function TrackerProjectPicker({
  api,
  provider = 'github',
  defaultTitle,
  value,
  onChange,
  onBusy,
}: {
  api: API;
  provider?: string;
  defaultTitle: string;
  value: string;
  onChange: (url: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { client, name: providerName, descriptor } = useTracker(api, provider);
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
        `Created “${project.title}” on ${providerName}. Complete this dialog to link it to ${defaultTitle}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
      onBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" aria-label="Project connection method">
        {[
          { value: 'pick', label: 'Choose existing' },
          { value: 'create', label: 'Create new' },
          { value: 'url', label: 'Use URL' },
        ]
          .filter((option) => option.value !== 'create' || descriptor?.capabilities.createProject)
          .map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={mode === option.value ? 'secondary' : 'ghost'}
              disabled={creating}
              aria-pressed={mode === option.value}
              onClick={() => {
                setMode(option.value);
                onChange('');
                setNotice('');
              }}
            >
              {option.label}
            </Button>
          ))}
      </div>
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
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              size="sm"
              disabled={creating}
              onClick={() => setRevision((n) => n + 1)}
            >
              Retry loading projects
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {mode === 'url' ? (
        <Input
          aria-label={`${providerName} URL`}
          placeholder="Project URL"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : mode === 'create' ? (
        <>
          <Input
            aria-label={`New ${providerName} project name`}
            maxLength={256}
            value={title}
            disabled={creating}
            onChange={(e) => {
              setTitleEdited(true);
              setTitle(e.target.value);
            }}
            placeholder="Project name"
          />
          <p className="text-xs text-muted-foreground">
            Creates a {providerName} project owned by {owner?.login || 'the selected account'}.
            Organization permissions may restrict creation.
          </p>
          <Button
            disabled={!owner || loading || creating || !title.trim()}
            onClick={() => void create()}
          >
            {creating ? 'Creating…' : `Create ${providerName} project`}
          </Button>
        </>
      ) : (
        <>
          <Input
            aria-label={`Search ${providerName} projects`}
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div
            className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1"
            aria-label={`Available ${providerName} projects`}
          >
            {loading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading projects…</p>
            ) : (
              projects
                .filter((p) => `${p.title} ${p.number}`.toLowerCase().includes(query.toLowerCase()))
                .map((project) => (
                  <Button
                    key={project.id}
                    variant={value === project.url ? 'secondary' : 'ghost'}
                    aria-pressed={value === project.url}
                    className="h-auto w-full justify-start whitespace-normal break-words px-3 py-3 text-left"
                    onClick={() => onChange(project.url)}
                  >
                    {project.title}
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">
                      {project.number ? `#${project.number}` : ''}
                    </span>
                  </Button>
                ))
            )}
            {!loading &&
              !error &&
              !projects.some((p) =>
                `${p.title} ${p.number}`.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <p className="py-4 text-sm text-muted-foreground">
                  {query
                    ? 'No matching projects.'
                    : 'No open projects yet. Choose Create new to get started.'}
                </p>
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
