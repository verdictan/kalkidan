import { useState, type ReactNode } from 'react';
import type { API } from '../types';
import type { ProjectAdminAction } from '../domain/github-mutations';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import { SegmentedControl } from './ui/segmented-control';
import { SectionHeader } from './ui/page-header';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { Choice } from './choice';
import { DangerZone, TypedConfirmDialog } from './dialog-parts';
import { errorMessage } from '../lib/errors';
import { roleLabel } from '../lib/github-labels';

type Role = 'NONE' | 'READER' | 'WRITER' | 'ADMIN';
const roles: Role[] = ['READER', 'WRITER', 'ADMIN', 'NONE'];

/**
 * Copy, team, access and delete actions for the linked GitHub project. Each action is explicit.
 * After each action the settings load again. After an error, the settings also load again, so
 * the next action starts from the current state on GitHub.
 */
export function GitHubProjectAdmin({
  api,
  groupId,
  revision,
  title,
  disabled,
  onChanged,
  onDeleted,
}: {
  api: API;
  groupId: string;
  revision: string;
  title: string;
  disabled: boolean;
  onChanged(): void;
  /** Called after GitHub deletes the project. */
  onDeleted?(): void;
}) {
  const [running, setRunning] = useState<ProjectAdminAction['kind'] | null>(null);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState('');
  const [copyTitle, setCopyTitle] = useState(`${title} copy`);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [teamOrg, setTeamOrg] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [accessKind, setAccessKind] = useState<'person' | 'team'>('person');
  const [user, setUser] = useState('');
  const [accessOrg, setAccessOrg] = useState('');
  const [accessSlug, setAccessSlug] = useState('');
  const [role, setRole] = useState<Role>('READER');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = disabled || running !== null;
  async function run(action: ProjectAdminAction, done: string) {
    if (locked) return;
    setRunning(action.kind);
    setError('');
    try {
      const result = await api.trackerProjectAction(groupId, revision, action);
      if (result.deleted) {
        setConfirmDelete(false);
        showToast('The GitHub project was deleted.');
        onDeleted?.();
      } else if (result.url) {
        const url = result.url;
        showToast({
          message: done,
          actions: [
            { label: 'Open copy', onClick: () => window.open(url, '_blank', 'noreferrer') },
          ],
        });
      } else showToast(done);
      onChanged();
    } catch (failure) {
      setConfirmDelete(false);
      setError(
        `${errorMessage(failure).replace(/\.?$/, '.')} Kalkidan loaded the project again. ` +
          'Check the result on GitHub before you try a copy or delete again.',
      );
      onChanged();
    } finally {
      setRunning(null);
    }
  }
  return (
    <div className="grid gap-6">
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AdminSection
        title="Copy project"
        help="Makes a new GitHub project with the same fields and views. Local folders and docs do not change."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-label">
            Destination owner
            <Input
              value={owner}
              disabled={locked}
              placeholder="organization or user"
              onChange={(event) => setOwner(event.target.value)}
            />
          </label>
          <label className="form-label">
            New project title
            <Input
              value={copyTitle}
              maxLength={256}
              disabled={locked}
              onChange={(event) => setCopyTitle(event.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CheckboxRow
            label="Include draft issues"
            checked={includeDrafts}
            disabled={locked}
            onChange={(event) => setIncludeDrafts(event.target.checked)}
          />
          <Button
            variant="outline"
            disabled={locked || !owner.trim() || !copyTitle.trim()}
            onClick={() =>
              void run(
                {
                  kind: 'copy',
                  owner: owner.trim(),
                  title: copyTitle.trim(),
                  includeDraftIssues: includeDrafts,
                },
                'Project copied.',
              )
            }
          >
            {running === 'copy' ? 'Copying…' : 'Copy project'}
          </Button>
        </div>
      </AdminSection>
      <AdminSection title="Teams" help="A linked team can find the project in its team page.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-label">
            Organization
            <Input
              value={teamOrg}
              disabled={locked}
              onChange={(event) => setTeamOrg(event.target.value)}
            />
          </label>
          <label className="form-label">
            Team
            <Input
              value={teamSlug}
              disabled={locked}
              placeholder="team-slug"
              onChange={(event) => setTeamSlug(event.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          {(['unlink', 'link'] as const).map((mode) => (
            <Button
              key={mode}
              variant={mode === 'link' ? 'outline' : 'ghost'}
              disabled={locked || !teamOrg.trim() || !teamSlug.trim()}
              onClick={() =>
                void run(
                  {
                    kind: 'team',
                    organization: teamOrg.trim(),
                    slug: teamSlug.trim(),
                    linked: mode === 'link',
                  },
                  mode === 'link' ? 'Team linked.' : 'Team unlinked.',
                )
              }
            >
              {mode === 'link' ? 'Link team' : 'Unlink team'}
            </Button>
          ))}
        </div>
      </AdminSection>
      <AdminSection
        title="Access"
        help="Give a person or a team access to the project, or remove their access."
      >
        <SegmentedControl
          size="sm"
          label="Give access to"
          className="justify-self-start"
          value={accessKind}
          onChange={setAccessKind}
          options={[
            { value: 'person', label: 'Person', disabled: locked },
            { value: 'team', label: 'Team', disabled: locked },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {accessKind === 'person' ? (
            <label className="form-label">
              GitHub user name
              <Input
                value={user}
                disabled={locked}
                onChange={(event) => setUser(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="form-label">
                Organization
                <Input
                  value={accessOrg}
                  disabled={locked}
                  onChange={(event) => setAccessOrg(event.target.value)}
                />
              </label>
              <label className="form-label">
                Team
                <Input
                  value={accessSlug}
                  disabled={locked}
                  placeholder="team-slug"
                  onChange={(event) => setAccessSlug(event.target.value)}
                />
              </label>
            </>
          )}
          <label className="form-label">
            Role
            <Choice
              className="w-full"
              label="Role"
              value={role}
              disabled={locked}
              onChange={(value) => setRole(value as Role)}
              options={roles.map((value) => ({ value, label: roleLabel(value) }))}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            disabled={
              locked ||
              (accessKind === 'person' ? !user.trim() : !accessOrg.trim() || !accessSlug.trim())
            }
            onClick={() =>
              void run(
                accessKind === 'person'
                  ? { kind: 'collaborator', user: user.trim(), role }
                  : {
                      kind: 'team-collaborator',
                      organization: accessOrg.trim(),
                      slug: accessSlug.trim(),
                      role,
                    },
                role === 'NONE' ? 'Access removed.' : 'Access changed.',
              )
            }
          >
            {running === 'collaborator' || running === 'team-collaborator'
              ? 'Saving…'
              : role === 'NONE'
                ? 'Remove access'
                : 'Set access'}
          </Button>
        </div>
      </AdminSection>
      <DangerZone
        title="Delete project"
        description="Deletes the GitHub project, its fields and its views. Issues and pull requests stay in their repositories."
        action={
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={locked}
            onClick={() => setConfirmDelete(true)}
          >
            Delete project…
          </Button>
        }
      />
      <TypedConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete the GitHub project?"
        description="You cannot undo this. Issues and pull requests stay in their repositories. Local folders and docs do not change."
        confirmText={title}
        actionLabel="Delete project"
        busy={running === 'delete'}
        onConfirm={() => void run({ kind: 'delete', confirmation: title }, 'Project deleted.')}
      />
    </div>
  );
}

function AdminSection({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-3">
      <div>
        <SectionHeader size="sm" title={title} className="mb-0.5" />
        <p className="form-help m-0">{help}</p>
      </div>
      {children}
    </section>
  );
}
