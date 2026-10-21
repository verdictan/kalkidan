import { GitHubProjectAdmin } from './github-project-admin';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookMarked, Users, X } from 'lucide-react';
import type { API } from '../types';
import type { ProjectSettings, ProjectSettingsAction } from '../domain/github-mutations';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { SectionHeader } from './ui/page-header';
import { EmptyState } from './ui/empty-state';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { Hint } from './hint';
import { FooterActions, UpdatedNote, holdDialogFocus, useInitialFocus } from './dialog-parts';
import { errorMessage } from '../lib/errors';
import { timestamp } from '../lib/github-labels';

type Draft = Pick<
  ProjectSettings,
  'title' | 'shortDescription' | 'readme' | 'public' | 'closed' | 'template'
>;
const draftOf = (settings: ProjectSettings): Draft => ({
  title: settings.title,
  shortDescription: settings.shortDescription,
  readme: settings.readme,
  public: settings.public,
  closed: settings.closed,
  template: settings.template,
});
const repositoryPattern = /^[\w.-]+\/[\w.-]+$/;

/**
 * The settings of the linked GitHub project. Edits stay local until Save changes. After each
 * write, and after a failed write, the settings load again from GitHub.
 */
export function GitHubProjectSettingsForm({
  api,
  groupId,
  footer,
  onSaved,
  onDeleted,
}: {
  api: API;
  groupId: string;
  /** The dialog footer element for Cancel and Save changes. */
  footer: HTMLElement | null;
  onSaved(): void;
  onDeleted?(): void;
}) {
  const [loaded, setLoaded] = useState<ProjectSettings>();
  const [draft, setDraft] = useState<Draft>();
  const [loadError, setLoadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [busy, setBusy] = useState<'loading' | 'saving' | null>('loading');
  const [reload, setReload] = useState(0);
  const [repository, setRepository] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number>();
  const epoch = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  useInitialFocus(root, !!loaded);
  useEffect(() => {
    const generation = ++epoch.current;
    setBusy('loading');
    setLoadError('');
    void api.trackerSettings(groupId).then(
      (settings) => {
        if (epoch.current !== generation) return;
        setLoaded(settings);
        setDraft(draftOf(settings));
        setBusy(null);
      },
      (error) => {
        if (epoch.current !== generation) return;
        setLoadError(errorMessage(error));
        setBusy(null);
      },
    );
    return () => {
      ++epoch.current;
    };
  }, [api, groupId, reload]);
  const writable = !!loaded?.writable;
  const disabled = busy !== null || !writable;
  const dirty = !!loaded && !!draft && JSON.stringify(draftOf(loaded)) !== JSON.stringify(draft);
  const edit = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  /** Runs the writes in order. Each write uses the revision that the one before returned. */
  async function write(actions: ProjectSettingsAction[]) {
    if (!loaded || busy || !writable || !actions.length) return;
    setBusy('saving');
    setWriteError('');
    let current = loaded;
    try {
      for (const action of actions)
        current = await api.trackerSettingsUpdate(groupId, current.revision, action);
      setLoaded(current);
      return current;
    } catch (error) {
      setWriteError(
        `${errorMessage(error).replace(/\.?$/, '.')} Kalkidan loaded the current settings. ` +
          'Check them before you save again.',
      );
      setReload((value) => value + 1);
      return undefined;
    } finally {
      setBusy(null);
      onSaved();
    }
  }
  async function save() {
    if (!loaded || !draft) return;
    const actions: ProjectSettingsAction[] = [];
    const base = draftOf(loaded);
    if (
      (['title', 'shortDescription', 'readme', 'public', 'closed'] as const).some(
        (key) => base[key] !== draft[key],
      )
    )
      actions.push({
        kind: 'update',
        title: draft.title,
        shortDescription: draft.shortDescription,
        readme: draft.readme,
        public: draft.public,
        closed: draft.closed,
      });
    if (base.template !== draft.template)
      actions.push({ kind: 'template', enabled: draft.template });
    const next = await write(actions);
    if (next) {
      setDraft(draftOf(next));
      setUpdatedAt(timestamp());
      showToast('Project settings saved.');
    }
  }
  async function linkRepository(nameWithOwner: string, linked: boolean) {
    const next = await write([{ kind: 'repository', nameWithOwner, linked }]);
    if (next) {
      if (linked) setRepository('');
      setUpdatedAt(timestamp());
      showToast(linked ? `Linked ${nameWithOwner}.` : `Unlinked ${nameWithOwner}.`);
    }
  }
  if (!loaded || !draft)
    return (
      <div ref={root} className="grid gap-3">
        {loadError ? (
          <Alert variant="destructive" size="sm">
            <AlertDescription>
              {loadError}
              <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>
                Reload settings
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading project settings…
          </p>
        )}
      </div>
    );
  const validRepository = repositoryPattern.test(repository.trim());
  return (
    <div ref={root} className="grid gap-6" aria-busy={busy !== null}>
      {!writable && (
        <Alert size="sm">
          <AlertDescription>You have read-only access to this project.</AlertDescription>
        </Alert>
      )}
      {writeError && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{writeError}</AlertDescription>
        </Alert>
      )}
      <section aria-label="Details" className="grid gap-4">
        <label className="form-label">
          Title
          <Input
            disabled={disabled}
            value={draft.title}
            maxLength={256}
            onChange={(event) => edit({ title: event.target.value })}
          />
        </label>
        <label className="form-label">
          Summary
          <Input
            disabled={disabled}
            value={draft.shortDescription}
            maxLength={256}
            onChange={(event) => edit({ shortDescription: event.target.value })}
          />
        </label>
        <label className="form-label">
          Description
          <Textarea
            disabled={disabled}
            value={draft.readme}
            maxLength={20000}
            rows={4}
            onChange={(event) => edit({ readme: event.target.value })}
          />
          <span className="form-help">Markdown. It shows in the README of the project.</span>
        </label>
      </section>
      <section aria-label="Visibility" className="grid gap-1">
        <SectionHeader size="sm" title="Visibility" />
        <SwitchRow
          label="Public project"
          help="Anyone on GitHub can see the project. Items in private repositories stay private."
          checked={draft.public}
          disabled={disabled}
          onChange={(value) => edit({ public: value })}
        />
        <SwitchRow
          label="Closed project"
          help="The project moves out of the list of open projects. You can open it again."
          checked={draft.closed}
          disabled={disabled}
          onChange={(value) => edit({ closed: value })}
        />
        <SwitchRow
          label="Use as a template"
          help="People in the organization can copy this project to start a new one."
          checked={draft.template}
          disabled={disabled}
          onChange={(value) => edit({ template: value })}
        />
      </section>
      <section aria-label="Linked repositories" className="grid gap-2">
        <SectionHeader size="sm" title="Linked repositories" count={loaded.repositories.length} />
        {loaded.repositories.length ? (
          <ul className="list-box m-0 list-none">
            {loaded.repositories.map((repo) => (
              <li key={repo.id} className="list-box-row">
                <BookMarked className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{repo.nameWithOwner}</span>
                <Hint label="Unlink">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled}
                    aria-label={`Unlink ${repo.nameWithOwner}`}
                    onClick={() => void linkRepository(repo.nameWithOwner, false)}
                  >
                    <X />
                  </Button>
                </Hint>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact>No linked repositories.</EmptyState>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (validRepository) void linkRepository(repository.trim(), true);
          }}
        >
          <Input
            aria-label="Repository (owner/name)"
            className="min-w-0 flex-1"
            value={repository}
            disabled={disabled}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="organization/repository"
          />
          <Button type="submit" variant="outline" disabled={disabled || !validRepository}>
            Link
          </Button>
        </form>
      </section>
      {!!loaded.teams?.length && (
        <section aria-label="Linked teams" className="grid gap-2">
          <SectionHeader size="sm" title="Linked teams" count={loaded.teams.length} />
          <ul className="list-box m-0 list-none">
            {loaded.teams.map((team) => (
              <li key={team.id} className="list-box-row">
                <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{team.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {team.organization}/{team.slug}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <GitHubProjectAdmin
        key={loaded.revision}
        api={api}
        groupId={groupId}
        revision={loaded.revision}
        title={loaded.title}
        disabled={disabled}
        onChanged={() => {
          setUpdatedAt(timestamp());
          setReload((value) => value + 1);
          onSaved();
        }}
        onDeleted={onDeleted}
      />
      <FooterActions target={footer}>
        <UpdatedNote at={updatedAt} />
        <DialogClose asChild>
          <Button variant="outline" disabled={busy === 'saving'}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          data-primary
          disabled={disabled || !dirty || !draft.title.trim()}
          onClick={() => void save()}
        >
          {busy === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
      </FooterActions>
    </div>
  );
}

/** A switch with its label and help text. The whole row toggles the switch. */
export function SwitchRow({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex min-h-[var(--row-height-2line)] items-center gap-3 py-1 has-[:disabled]:opacity-60">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm">{label}</span>
        {help && <span className="text-xs leading-4 text-muted-foreground">{help}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

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
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll" onOpenAutoFocus={holdDialogFocus}>
        <DialogHeader>
          <DialogTitle>GitHub project settings</DialogTitle>
          <DialogDescription>Changes apply to the linked project on GitHub.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {open && (
            <GitHubProjectSettingsForm
              api={api}
              groupId={groupId}
              footer={footer}
              onSaved={onSaved}
              onDeleted={() => onOpenChange(false)}
            />
          )}
        </DialogBody>
        <DialogFooter ref={setFooter} className="empty:hidden" />
      </DialogContent>
    </Dialog>
  );
}
