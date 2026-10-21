import { useState } from 'react';
import { Folder, FolderGit2, FolderPlus, GitBranch, Monitor, Server } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost } from '../types';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import { worktreeParent } from '../lib/worktree-sessions';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import { DialogClose } from './ui/dialog';
import { DangerZone, FooterActions } from './dialog-parts';

const colorName = (value: ProjectColor | null) =>
  value ? value[0].toUpperCase() + value.slice(1) : 'Default';

/** The name and color of a project, and where its work runs. */
export function ProjectGeneral({
  api,
  group,
  host,
  footer,
  onSaved,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  footer: HTMLElement | null;
  onSaved(): void | Promise<void>;
}) {
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState<ProjectColor | null>(group.color || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = name.trim() !== group.name || color !== (group.color || null);
  const canSave = !busy && !!name.trim() && changed;
  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      if (name.trim() !== group.name) await api.updateGroup(group.id, name.trim());
      if (color !== (group.color || null)) await api.setGroupColor(group.id, color);
      showToast('Project saved.');
      await onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      id="project-general-form"
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="form-label">
        Project name
        <Input
          value={name}
          maxLength={150}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Customer platform"
        />
      </label>
      <fieldset className="project-settings-colors" disabled={busy}>
        <legend className="form-label">Folder color</legend>
        <div className="flex flex-wrap gap-2">
          {([null, ...Object.keys(projectColors)] as (ProjectColor | null)[]).map((value) => (
            <Button
              key={value || 'default'}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${colorName(value)} folder`}
              aria-pressed={color === value}
              title={colorName(value)}
              onClick={() => setColor(value)}
              style={{ color: value ? projectColors[value] : 'var(--muted-foreground)' }}
            >
              <Folder />
            </Button>
          ))}
        </div>
      </fieldset>
      <section aria-label="Where work runs" className="grid gap-2">
        <SectionHeader size="sm" title="Where work runs" className="mb-0" />
        <div className="project-settings-location">
          {group.hostId ? <Server aria-hidden="true" /> : <Monitor aria-hidden="true" />}
          <div className="min-w-0">
            <strong>
              {group.hostId ? `SSH host: ${host?.name || 'Remote host'}` : 'This computer'}
            </strong>
            {group.hostId && (
              <span title={host?.target}>
                {host?.target || 'Unknown target'} · {host?.status || 'disconnected'}
              </span>
            )}
            <span title={group.rootPath}>
              {group.rootPath
                ? `Project folder: ${group.rootPath}`
                : group.hostId
                  ? 'The project folder is set when the project opens on its host.'
                  : 'No project folder.'}
            </span>
          </div>
        </div>
        <p className="form-help m-0">
          You cannot change where work runs. To use a different computer, create a new project
          there.
        </p>
      </section>
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FooterActions target={footer}>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" form="project-general-form" data-primary disabled={!canSave}>
          {busy ? 'Saving…' : 'Save project'}
        </Button>
      </FooterActions>
    </form>
  );
}

/** The code folders of a project: the list, Add a code folder and Remove. */
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
  onRemove(repo: Project): void;
}) {
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  return (
    <section aria-label="Code folders" className="project-settings-folders grid gap-3">
      <SectionHeader
        size="sm"
        title="Code folders"
        count={members.length}
        className="mb-0"
        actions={
          <Button variant="outline" size="sm" onClick={onAdd}>
            <FolderPlus />
            Add a code folder…
          </Button>
        }
      />
      <p className="form-help m-0">
        Agents read and change the files in these folders. Remove a folder to stop showing it. The
        folder, its files and its chats stay on disk.
      </p>
      {members.length ? (
        <ul className="list-box">
          {members.map((repo) => {
            const copy = !!worktreeParent(repo, members);
            return (
              <li key={repo.id} className="list-box-row">
                {copy ? <FolderGit2 size={14} /> : <GitBranch size={14} />}
                <div className="min-w-0 flex-1">
                  <strong>{repo.name}</strong>
                  <span title={repo.path}>
                    {copy ? 'Branch copy · ' : ''}
                    {repo.path}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove ${repo.name} from this project`}
                  onClick={() => onRemove(repo)}
                >
                  Remove…
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact>No code folders in this project yet.</EmptyState>
      )}
    </section>
  );
}

/** Removes the project from Kalkidan with the same confirmation as before. */
export function ProjectDangerZone({ group, onRemove }: { group: ProjectGroup; onRemove(): void }) {
  return (
    <section aria-label="Danger zone" className="grid gap-3">
      <SectionHeader size="sm" title="Danger zone" className="mb-0" />
      <DangerZone
        title="Remove project"
        description={`Kalkidan stops showing ${group.name}. All files stay on disk.`}
        action={
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            Remove project…
          </Button>
        }
      />
    </section>
  );
}
