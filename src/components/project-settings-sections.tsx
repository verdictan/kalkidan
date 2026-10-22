import { useEffect, useId, useState } from 'react';
import { Folder, FolderPlus, Trash2 } from 'lucide-react';
import type { API, Project, ProjectGroup } from '../types';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import { worktreeParent } from '../lib/worktree-sessions';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { showToast } from './ui/toast';
import { ConfirmDialog } from './confirm-dialog';
import { Hint } from './hint';
import { SettingsRow, SettingsRows } from './settings-disclosure';

// The one SettingsRow. Board settings in other files import it from here too.
export { SettingsRow, SettingsRows } from './settings-disclosure';

const colorName = (value: ProjectColor | null) =>
  value ? value[0].toUpperCase() + value.slice(1) : 'Default';

/**
 * The name and color of a project, and the removal of the project. The color saves at once with
 * Undo. The name saves when you press Enter or leave the field.
 */
export function ProjectGeneral({
  api,
  group,
  location,
  onSaved,
  onRemove,
}: {
  api: API;
  group: ProjectGroup;
  /** Where the project is, for example the SSH host. It shows under the name. */
  location?: string;
  onSaved(): void | Promise<void>;
  /** Starts the removal of the project. Without it, the Remove project row does not show. */
  onRemove?(): void;
}) {
  const nameId = useId();
  const [name, setName] = useState(group.name);
  const [savedName, setSavedName] = useState(group.name);
  const [color, setColor] = useState<ProjectColor | null>(group.color || null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  // Take the values again when the project changes from somewhere else.
  useEffect(() => {
    setName(group.name);
    setSavedName(group.name);
  }, [group.name]);
  useEffect(() => setColor(group.color || null), [group.color]);
  async function saveName() {
    const next = name.trim();
    if (!next) {
      setName(savedName);
      return;
    }
    if (next === savedName || state === 'saving') return;
    setState('saving');
    setError('');
    try {
      await api.updateGroup(group.id, next);
      setSavedName(next);
      setName(next);
      setState('saved');
      await onSaved();
    } catch (failure) {
      setState('idle');
      setError(errorMessage(failure));
    }
  }
  async function changeColor(next: ProjectColor | null) {
    const previous = color;
    if (next === previous) return;
    setColor(next);
    setError('');
    try {
      await api.setGroupColor(group.id, next);
      await onSaved();
      showToast({
        message: `Color changed to ${colorName(next).toLowerCase()}.`,
        actions: [
          {
            label: 'Undo',
            onClick: () => {
              setColor(previous);
              void api
                .setGroupColor(group.id, previous)
                .then(onSaved)
                .catch((failure) => setError(errorMessage(failure)));
            },
          },
        ],
      });
    } catch (failure) {
      setColor(previous);
      setError(errorMessage(failure));
    }
  }
  const nameState =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : name.trim() !== savedName
          ? 'Press Enter to save.'
          : '';
  return (
    <div id="project-general-form" className="contents">
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <SettingsRows label="Project">
        <SettingsRow
          label="Name"
          htmlFor={nameId}
          help={nameState ? <span role="status">{nameState}</span> : location}
        >
          <Input
            id={nameId}
            className="w-60"
            value={name}
            maxLength={150}
            aria-label="Project name"
            onChange={(event) => {
              setName(event.target.value);
              if (state === 'saved') setState('idle');
            }}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void saveName();
            }}
          />
        </SettingsRow>
        <SettingsRow label="Color">
          <div role="group" aria-label="Color" className="project-settings-colors">
            {([null, ...Object.keys(projectColors)] as (ProjectColor | null)[]).map((value) => (
              <Hint key={value || 'default'} label={colorName(value)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${colorName(value)} folder`}
                  aria-pressed={color === value}
                  onClick={() => void changeColor(value)}
                  style={{ color: value ? projectColors[value] : 'var(--muted-foreground)' }}
                >
                  <Folder />
                </Button>
              </Hint>
            ))}
          </div>
        </SettingsRow>
      </SettingsRows>
      {onRemove && (
        <SettingsRows label="Remove project">
          <SettingsRow
            label="Remove project"
            help={`Kalkidan stops showing ${group.name}. All files stay on disk.`}
          >
            <Button variant="destructive-outline" size="sm" onClick={onRemove}>
              Remove project…
            </Button>
          </SettingsRow>
        </SettingsRows>
      )}
    </div>
  );
}

/**
 * The code folders of a project: the list, "Add code folder…", and "Remove code folder…" on
 * each row. The confirmation opens over Project settings, which stays open.
 */
export function ProjectCodeFolders({
  group,
  repos,
  onAdd,
  onRemove,
}: {
  group: ProjectGroup;
  /** All code folders. The section shows the code folders of this project. */
  repos: Project[];
  onAdd(): void;
  /** Removes a code folder after the user confirms it. */
  onRemove(repo: Project): Promise<void>;
}) {
  const [removing, setRemoving] = useState<Project>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    setError('');
    try {
      await onRemove(removing);
      setRemoving(undefined);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const add = (
    <Button variant="ghost" size="sm" className="-ml-2 justify-self-start" onClick={onAdd}>
      <FolderPlus />
      Add code folder…
    </Button>
  );
  return (
    <section
      id="project-folders"
      tabIndex={-1}
      aria-labelledby="project-folders-label"
      className="settings-group outline-none"
    >
      <h3 id="project-folders-label" className="group-label">
        Code folders
      </h3>
      {members.length ? (
        <div className="grid gap-2">
          <SettingsRows label="Code folders">
            {members.map((repo) => {
              const copy = !!worktreeParent(repo, members);
              return (
                <SettingsRow
                  key={repo.id}
                  label={repo.name}
                  help={
                    <Hint label={repo.path}>
                      <span className="block truncate">
                        {copy ? 'Branch copy · ' : ''}
                        {repo.path}
                      </span>
                    </Hint>
                  }
                >
                  <Hint label="Remove code folder…">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="settings-row-hover-action"
                      aria-label={`Remove code folder ${repo.name}…`}
                      onClick={() => {
                        setError('');
                        setRemoving(repo);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </Hint>
                </SettingsRow>
              );
            })}
          </SettingsRows>
          {add}
        </div>
      ) : (
        <EmptyState compact title="No code folders." action={add} />
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name || 'the code folder'} from ${group.name}?`}
        description="Kalkidan stops showing it. The folder and its files stay on disk."
        confirmLabel="Remove code folder"
        destructive
        busy={busy}
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => void remove()}
      >
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
