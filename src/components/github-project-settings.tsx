import { GitHubProjectAdmin } from './github-project-admin';
import { useEffect, useRef, useState } from 'react';
import type { API } from '../types';
import type { ProjectSettings, ProjectSettingsAction } from '../domain/github-mutations';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { errorMessage } from '../lib/errors';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; settings: ProjectSettings }
  | { phase: 'saving'; settings: ProjectSettings }
  | { phase: 'error'; message: string };

export function GitHubProjectSettingsDialog({
  api,
  groupId,
  open,
  onOpenChange,
  onSaved,
}: {
  api: API;
  groupId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(): void;
}) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [repository, setRepository] = useState('');
  const epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    if (!open) return;
    setState({ phase: 'loading' });
    setDirty(false);
    void api.trackerSettings(groupId).then(
      (settings) => {
        if (epoch.current === generation) setState({ phase: 'ready', settings });
      },
      (error) => {
        if (epoch.current === generation)
          setState({ phase: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      ++epoch.current;
    };
  }, [api, groupId, open, reload]);
  const settings = state.phase === 'ready' || state.phase === 'saving' ? state.settings : undefined;
  const disabled = state.phase !== 'ready' || !settings?.writable;
  function edit(patch: Partial<ProjectSettings>) {
    setDirty(true);
    setState((current) =>
      current.phase === 'ready'
        ? { ...current, settings: { ...current.settings, ...patch } }
        : current,
    );
  }
  async function save(action: ProjectSettingsAction) {
    if (state.phase !== 'ready' || !state.settings.writable) return;
    const generation = epoch.current;
    setState({ phase: 'saving', settings: state.settings });
    try {
      const next = await api.trackerSettingsUpdate(groupId, state.settings.revision, action);
      onSaved();
      if (epoch.current === generation) {
        setDirty(false);
        setState({ phase: 'ready', settings: next });
      }
    } catch (error) {
      if (epoch.current === generation) setState({ phase: 'error', message: errorMessage(error) });
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>GitHub project settings</DialogTitle>
          <DialogDescription>Changes apply to the linked project on GitHub.</DialogDescription>
        </DialogHeader>
        {state.phase === 'loading' && <p role="status">Loading project settings…</p>}
        {state.phase === 'error' && (
          <>
            <Alert variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
            <p>Reload to check the current settings before you make another change.</p>
            <Button onClick={() => setReload((value) => value + 1)}>Reload settings</Button>
          </>
        )}
        {settings && (
          <>
            {!settings.writable && <p>You have read-only access to this project.</p>}
            <label className="form-label">
              Title
              <Input
                disabled={disabled}
                value={settings.title}
                maxLength={256}
                onChange={(event) => edit({ title: event.target.value })}
              />
            </label>
            <label className="form-label">
              Summary
              <Input
                disabled={disabled}
                value={settings.shortDescription}
                maxLength={256}
                onChange={(event) => edit({ shortDescription: event.target.value })}
              />
            </label>
            <label className="form-label">
              Description
              <Textarea
                disabled={disabled}
                value={settings.readme}
                maxLength={20000}
                rows={5}
                onChange={(event) => edit({ readme: event.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                disabled={disabled}
                checked={settings.public}
                onChange={(event) => edit({ public: event.target.checked })}
              />{' '}
              Public project
            </label>
            <label>
              <input
                type="checkbox"
                disabled={disabled}
                checked={settings.closed}
                onChange={(event) => edit({ closed: event.target.checked })}
              />{' '}
              Closed project
            </label>
            <Button
              variant="outline"
              disabled={disabled || dirty}
              onClick={() => void save({ kind: 'template', enabled: !settings.template })}
            >
              {settings.template ? 'Remove template status' : 'Use as a template'}
            </Button>
            {dirty && (
              <p className="help-text">
                Save your changes before you change template status or repository links.
              </p>
            )}
            {!!settings.teams?.length && (
              <section aria-label="Linked teams">
                <h3>Linked teams</h3>
                {settings.teams.map((team) => (
                  <p key={team.id}>
                    {team.organization}/{team.slug} · {team.name}
                  </p>
                ))}
              </section>
            )}
            <GitHubProjectAdmin
              key={settings.revision}
              api={api}
              groupId={groupId}
              revision={settings.revision}
              title={settings.title}
              disabled={disabled || dirty}
              onChanged={() => {
                setReload((value) => value + 1);
                onSaved();
              }}
            />
            <section aria-label="Linked repositories" className="space-y-2">
              <h3>Linked repositories</h3>
              {settings.repositories.map((repo) => (
                <div key={repo.id} className="flex items-center justify-between gap-2">
                  <span>{repo.nameWithOwner}</span>
                  <Button
                    variant="ghost"
                    disabled={disabled || dirty}
                    onClick={() =>
                      void save({
                        kind: 'repository',
                        nameWithOwner: repo.nameWithOwner,
                        linked: false,
                      })
                    }
                    aria-label={`Unlink ${repo.nameWithOwner}`}
                  >
                    Unlink
                  </Button>
                </div>
              ))}
              <label className="form-label">
                Repository (owner/name)
                <Input
                  value={repository}
                  disabled={disabled || dirty}
                  onChange={(event) => setRepository(event.target.value)}
                  placeholder="organization/repository"
                />
              </label>
              <Button
                variant="outline"
                disabled={disabled || dirty || !/^[\w.-]+\/[\w.-]+$/.test(repository)}
                onClick={() =>
                  void save({ kind: 'repository', nameWithOwner: repository, linked: true })
                }
              >
                Link repository
              </Button>
            </section>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={disabled || !settings?.title.trim()}
            onClick={() =>
              settings &&
              void save({
                kind: 'update',
                title: settings.title,
                shortDescription: settings.shortDescription,
                readme: settings.readme,
                public: settings.public,
                closed: settings.closed,
              })
            }
          >
            {state.phase === 'saving' ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
