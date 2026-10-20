import { useState } from 'react';
import type { API } from '../types';
import type { ProjectAdminAction, ProjectAdminResult } from '../domain/github-mutations';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';

/** Administration is explicit. Failed writes require reconciliation before another write. */
export function GitHubProjectAdmin({
  api,
  groupId,
  revision,
  title,
  disabled,
  onChanged,
}: {
  api: API;
  groupId: string;
  revision: string;
  title: string;
  disabled: boolean;
  onChanged(): void;
}) {
  const [kind, setKind] = useState<ProjectAdminAction['kind']>('copy');
  const [owner, setOwner] = useState('');
  const [value, setValue] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [linked, setLinked] = useState(true);
  const [role, setRole] = useState<'NONE' | 'READER' | 'WRITER' | 'ADMIN'>('READER');
  const [state, setState] = useState<'ready' | 'saving' | 'reload'>('ready');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProjectAdminResult>();
  async function submit() {
    if (disabled || state !== 'ready') return;
    const action: ProjectAdminAction =
      kind === 'copy'
        ? { kind, owner, title: value, includeDraftIssues: includeDrafts }
        : kind === 'delete'
          ? { kind, confirmation: value }
          : kind === 'collaborator'
            ? { kind, user: value, role }
            : kind === 'team'
              ? { kind, organization: owner, slug: value, linked }
              : { kind, organization: owner, slug: value, role };
    setState('saving');
    setError('');
    try {
      setResult(await api.trackerProjectAction(groupId, revision, action));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setState('reload');
    }
  }
  return (
    <details className="space-y-3">
      <summary>Project administration</summary>
      <p className="help-text">
        These actions change the linked GitHub project. Local repositories and documents stay in
        place.
      </p>
      {state === 'reload' ? (
        <div role="status">
          {error ? (
            <p role="alert">
              {error} Reload before another action. Do not repeat an uncertain copy or delete.
            </p>
          ) : (
            <p>
              {result?.deleted ? 'The GitHub project was deleted.' : 'The GitHub action completed.'}
            </p>
          )}
          {result?.url && (
            <p>
              <a href={result.url} target="_blank" rel="noreferrer">
                Open copied project
              </a>
            </p>
          )}
          <Button variant="outline" onClick={onChanged}>
            Reload project
          </Button>
        </div>
      ) : (
        <>
          <label className="form-label">
            Action
            <select
              value={kind}
              disabled={disabled || state === 'saving'}
              onChange={(event) => {
                setKind(event.target.value as ProjectAdminAction['kind']);
                setValue('');
              }}
            >
              <option value="copy">Copy project</option>
              <option value="team">Link or unlink team</option>
              <option value="collaborator">User access</option>
              <option value="team-collaborator">Team access</option>
              <option value="delete">Delete GitHub project</option>
            </select>
          </label>
          {['copy', 'team', 'team-collaborator'].includes(kind) && (
            <label className="form-label">
              {kind === 'copy' ? 'Destination owner' : 'Organization'}
              <Input
                value={owner}
                disabled={disabled || state === 'saving'}
                onChange={(event) => setOwner(event.target.value)}
              />
            </label>
          )}
          <label className="form-label">
            {kind === 'copy'
              ? 'New project title'
              : kind === 'delete'
                ? `Type “${title}” to delete`
                : kind === 'collaborator'
                  ? 'GitHub user name'
                  : 'Team slug'}
            <Input
              value={value}
              disabled={disabled || state === 'saving'}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {kind === 'copy' && (
            <label>
              <input
                type="checkbox"
                checked={includeDrafts}
                disabled={disabled || state === 'saving'}
                onChange={(event) => setIncludeDrafts(event.target.checked)}
              />{' '}
              Include draft issues
            </label>
          )}
          {kind === 'team' && (
            <label>
              <input
                type="checkbox"
                checked={linked}
                disabled={disabled || state === 'saving'}
                onChange={(event) => setLinked(event.target.checked)}
              />{' '}
              Link team (clear to unlink)
            </label>
          )}
          {['collaborator', 'team-collaborator'].includes(kind) && (
            <label className="form-label">
              Role
              <select
                value={role}
                disabled={disabled || state === 'saving'}
                onChange={(event) => setRole(event.target.value as typeof role)}
              >
                <option value="READER">Read</option>
                <option value="WRITER">Write</option>
                <option value="ADMIN">Admin</option>
                <option value="NONE">Remove access</option>
              </select>
            </label>
          )}
          <Button
            variant={kind === 'delete' ? 'destructive' : 'outline'}
            disabled={
              disabled ||
              state !== 'ready' ||
              !value.trim() ||
              (kind === 'delete' && value !== title)
            }
            onClick={() => void submit()}
          >
            {state === 'saving'
              ? 'Applying…'
              : kind === 'delete'
                ? 'Delete GitHub project'
                : 'Apply action'}
          </Button>
        </>
      )}
    </details>
  );
}
