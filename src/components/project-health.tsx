import { useRef, useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { API, TrackerBoard } from '../types';
import {
  healthStatuses,
  projectHealthCounts,
  projectHealthReport,
  type HealthStatus,
} from '../domain/project-health';
import { Button } from './ui/button';
import { StatusDot } from './ui/status-dot';
import { SegmentedControl } from './ui/segmented-control';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import { ActionRow, ErrorAlert } from './planning-kit';
import { Hint } from './hint';
import { errorMessage } from '../lib/errors';

/**
 * Post a status update: choose the health (On track, At risk…), write a report from a fresh
 * board snapshot, then publish it on GitHub. The task counts are on the Tasks header line.
 */
export function ProjectHealth({
  api,
  groupId,
}: {
  api: API;
  groupId: string;
  /** Not used any more. Kept so that older callers compile. */
  board?: TrackerBoard;
  /** Not used any more. Kept so that older callers compile. */
  onFilter?: (filter: { status?: string; repository?: string }) => void;
}) {
  const [body, setBody] = useState(''),
    [snapshot, setSnapshot] = useState<TrackerBoard>(),
    [status, setStatus] = useState<HealthStatus>('ON_TRACK'),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [published, setPublished] = useState(false);
  const pending = useRef(false);
  async function prepare() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setPublished(false);
    setEditing(false);
    try {
      const fresh = await api.trackerBoard(groupId, true);
      setSnapshot(fresh);
      setBody(projectHealthReport(fresh, Date.now()));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function publish() {
    if (!snapshot || pending.current || published) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const current = await api.trackerBoard(groupId, true);
      if (!current.cache?.revision || current.cache.revision !== snapshot.cache?.revision)
        throw new Error('The board changed after you wrote the report. Write a new report.');
      const updates = await api.trackerResources(groupId, 'statusUpdates');
      await api.trackerResourceChange(groupId, updates.revision, 'createProjectV2StatusUpdate', {
        body,
        status,
      });
      setPublished(true);
      setEditing(false);
      showToast('Published the status update on GitHub.');
    } catch (failure) {
      setError(
        `${errorMessage(failure)} If you are not sure that GitHub has the update, check the board on GitHub first.`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Board health" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Project health"
          value={status}
          onChange={setStatus}
          size="sm"
          className="w-fit max-w-full flex-wrap"
          options={healthStatuses.map((option) => ({
            value: option.value,
            label: option.label,
            disabled: busy || published,
            icon: <StatusDot tone={option.tone} />,
          }))}
        />
        {!body && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void prepare()}>
            {busy ? 'Writing report…' : 'Write report'}
          </Button>
        )}
      </div>
      {body && (
        <div className="panel grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {editing ? 'Edit report' : 'Report preview'}
            </span>
            <div className="flex gap-2">
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void prepare()}>
                Write again
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy || published}
                onClick={() => setEditing(!editing)}
              >
                {editing ? 'Preview' : 'Edit'}
              </Button>
            </div>
          </div>
          {editing ? (
            <Textarea
              aria-label="Project health report preview"
              className="min-h-64 font-mono text-xs"
              value={body}
              maxLength={20000}
              onChange={(event) => setBody(event.target.value)}
              disabled={busy || published}
            />
          ) : (
            <div className="prose-ui max-h-80 overflow-y-auto" data-size="sm">
              <Markdown skipHtml remarkPlugins={[remarkGfm]}>
                {body}
              </Markdown>
            </div>
          )}
        </div>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {body && (
        <ActionRow>
          <Button
            disabled={busy || published || !body.trim() || !snapshot?.writable}
            onClick={() => void publish()}
          >
            {published ? 'Published' : busy ? 'Publishing…' : 'Publish status update'}
          </Button>
        </ActionRow>
      )}
      {snapshot && !snapshot.writable && (
        <p className="form-help">You can only read this board. Ask the owner for access.</p>
      )}
    </section>
  );
}

/**
 * The board health line of the Tasks header. It shows only what the columns do not show:
 * tasks without a repository, hidden tasks and the sync state. Each count filters the board.
 * It shows nothing when the board is healthy and synced.
 */
export function BoardHealthLine({
  board,
  syncing,
  syncError,
  onRetry,
  onSignIn,
  onFilter,
}: {
  board: TrackerBoard;
  syncing: boolean;
  /** The last sync error. "Could not sync" shows with Try again, or Sign in with `onSignIn`. */
  syncError?: string;
  onRetry(): void;
  onSignIn?(): void;
  onFilter(filter: { status?: string; repository?: string }): void;
}) {
  const noRepository = projectHealthCounts(board).find((row) => row.label === 'No repository');
  const hidden = board.restrictedItems || 0;
  const parts = [
    noRepository && noRepository.count > 0 && (
      <button
        key="repository"
        type="button"
        className="board-health-link"
        onClick={() => onFilter(noRepository.filter)}
      >
        {noRepository.count} without a repository
      </button>
    ),
    hidden > 0 && (
      <Hint key="hidden" label="You cannot read these tasks on GitHub.">
        <span className="board-health-text" tabIndex={0}>
          {hidden} hidden
        </span>
      </Hint>
    ),
  ].filter(Boolean);
  if (!syncing && !syncError && !parts.length) return null;
  return (
    <span className="board-health" aria-label="Board health">
      {syncing ? (
        <span className="board-health-text" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          Syncing…
        </span>
      ) : syncError ? (
        <span className="board-health-error">
          <Hint label={syncError}>
            <span className="board-health-text" data-tone="error" tabIndex={0}>
              <TriangleAlert aria-hidden="true" />
              Could not sync
            </span>
          </Hint>
          <button type="button" className="board-health-link" onClick={onSignIn || onRetry}>
            {onSignIn ? 'Sign in' : 'Try again'}
          </button>
        </span>
      ) : null}
      {parts.map((part, index) => (
        <span key={index} className="board-health-part">
          {(index > 0 || syncing || !!syncError) && <span aria-hidden="true">·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}
