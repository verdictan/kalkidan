import { GitHubProjectAdmin } from './github-project-admin';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BookMarked, ChevronRight, Users, X } from 'lucide-react';
import type { API } from '../types';
import type { ProjectSettings, ProjectSettingsAction } from '../domain/github-mutations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { SectionHeader } from './ui/page-header';
import { EmptyState } from './ui/empty-state';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Hint } from './hint';
import { useInitialFocus } from './dialog-parts';
import { ResourceAlert } from './github-project-resources';
import { SettingsRow, SettingsRows } from './project-settings-sections';
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
 * The settings of the linked GitHub project. Switches save at once with Undo. Text saves when you
 * press Enter or leave the field. After each write, and after a failed write, the settings load
 * again from GitHub.
 */
export function GitHubProjectSettingsForm({
  api,
  groupId,
  onSaved,
  onDeleted,
}: {
  api: API;
  groupId: string;
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
  const [savedText, setSavedText] = useState<number>();
  const epoch = useRef(0);
  // The writes read the newest settings from here, so that Undo uses the newest revision.
  const latest = useRef(loaded);
  latest.current = loaded;
  const writing = useRef(false);
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
  const edit = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  /** Runs the writes in order. Each write uses the revision that the one before returned. */
  async function write(actions: ProjectSettingsAction[]) {
    let current = latest.current;
    if (!current?.writable || writing.current || !actions.length) return;
    writing.current = true;
    setBusy('saving');
    setWriteError('');
    try {
      for (const action of actions)
        current = await api.trackerSettingsUpdate(groupId, current.revision, action);
      latest.current = current;
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
      writing.current = false;
      setBusy(null);
      onSaved();
    }
  }
  /** Sends the draft to GitHub. Returns the new settings, or nothing after an error. */
  async function save(next: Draft) {
    if (!latest.current) return;
    const base = draftOf(latest.current);
    const actions: ProjectSettingsAction[] = [];
    if (
      (['title', 'shortDescription', 'readme', 'public', 'closed'] as const).some(
        (key) => base[key] !== next[key],
      )
    )
      actions.push({
        kind: 'update',
        title: next.title,
        shortDescription: next.shortDescription,
        readme: next.readme,
        public: next.public,
        closed: next.closed,
      });
    if (base.template !== next.template) actions.push({ kind: 'template', enabled: next.template });
    const result = await write(actions);
    if (result) setDraft(draftOf(result));
    return result;
  }
  /** Saves the text fields when they changed. An empty title goes back to the saved title. */
  async function saveText() {
    if (!loaded || !draft || busy) return;
    if (!draft.title.trim()) {
      edit({ title: loaded.title });
      return;
    }
    const base = draftOf(loaded);
    if (
      base.title === draft.title &&
      base.shortDescription === draft.shortDescription &&
      base.readme === draft.readme
    )
      return;
    const { title, shortDescription, readme } = draft;
    if (await save({ ...base, title, shortDescription, readme })) setSavedText(timestamp());
  }
  /** Saves a switch at once. The toast has Undo. */
  async function toggle(key: 'public' | 'closed' | 'template', value: boolean, label: string) {
    if (!loaded || busy) return;
    const base = draftOf(loaded);
    edit({ [key]: value });
    const result = await save({ ...base, [key]: value });
    if (!result) return;
    showToast({
      message: label,
      actions: [
        {
          label: 'Undo',
          onClick: () => {
            if (!latest.current) return;
            edit({ [key]: !value });
            void save({ ...draftOf(latest.current), [key]: !value });
          },
        },
      ],
    });
  }
  async function linkRepository(nameWithOwner: string, linked: boolean) {
    const next = await write([{ kind: 'repository', nameWithOwner, linked }]);
    if (next) {
      if (linked) setRepository('');
      showToast(linked ? `Linked ${nameWithOwner}.` : `Unlinked ${nameWithOwner}.`);
    }
  }
  if (!loaded || !draft)
    return (
      <div ref={root} className="grid gap-3">
        {loadError ? (
          <ResourceAlert message={loadError}>
            <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>
              Load again
            </Button>
          </ResourceAlert>
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
            disabled={!writable}
            value={draft.title}
            maxLength={256}
            onChange={(event) => edit({ title: event.target.value })}
            onBlur={() => void saveText()}
            onKeyDown={submitOnEnter}
          />
        </label>
        <label className="form-label">
          Summary
          <Input
            disabled={!writable}
            value={draft.shortDescription}
            maxLength={256}
            onChange={(event) => edit({ shortDescription: event.target.value })}
            onBlur={() => void saveText()}
            onKeyDown={submitOnEnter}
          />
        </label>
        <label className="form-label">
          Description
          <Textarea
            disabled={!writable}
            value={draft.readme}
            maxLength={20000}
            rows={4}
            onChange={(event) => edit({ readme: event.target.value })}
            onBlur={() => void saveText()}
          />
          <span className="form-help" role="status">
            {busy === 'saving'
              ? 'Saving…'
              : savedText
                ? 'Saved'
                : 'Markdown. It shows in the README of the project. Saves when you leave the field.'}
          </span>
        </label>
      </section>
      <SettingsRows label="Visibility">
        <SwitchRow
          label="Public project"
          help="Anyone on GitHub can see it. Items in private repositories stay private."
          checked={draft.public}
          disabled={disabled}
          onChange={(value) =>
            void toggle(
              'public',
              value,
              value ? 'The project is public.' : 'The project is private.',
            )
          }
        />
        <SwitchRow
          label="Closed project"
          help="The project moves out of the list of open projects."
          checked={draft.closed}
          disabled={disabled}
          onChange={(value) =>
            void toggle('closed', value, value ? 'The project is closed.' : 'The project is open.')
          }
        />
        <SwitchRow
          label="Use as a template"
          help="People in the organization can copy this project."
          checked={draft.template}
          disabled={disabled}
          onChange={(value) =>
            void toggle(
              'template',
              value,
              value ? 'The project is a template.' : 'The project is not a template.',
            )
          }
        />
      </SettingsRows>
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
          <EmptyState compact icon={<BookMarked />}>
            No linked repositories.
          </EmptyState>
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
      <Collapsible className="project-settings-advanced">
        <CollapsibleTrigger className="project-settings-advanced-trigger">
          <ChevronRight aria-hidden="true" />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <GitHubProjectAdmin
            key={loaded.revision}
            api={api}
            groupId={groupId}
            revision={loaded.revision}
            title={loaded.title}
            disabled={disabled}
            onChanged={() => {
              setReload((value) => value + 1);
              onSaved();
            }}
            onDeleted={onDeleted}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** A switch with its label and help text, as a settings row. The whole row toggles the switch. */
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
    <label className="block has-[:disabled]:opacity-60">
      <SettingsRow label={label} help={help}>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={label}
        />
      </SettingsRow>
    </label>
  );
}

/** Enter in a one-line field saves it: the field loses focus, and the blur handler saves. */
function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.currentTarget.blur();
}
