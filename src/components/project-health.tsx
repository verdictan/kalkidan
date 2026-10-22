import { useRef, useState } from 'react';
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
import { SegmentedControl } from './ui/segmented-control';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import { ActionRow, ErrorAlert } from './planning-kit';
import { errorMessage } from '../lib/errors';

/**
 * The health of a project: one row of task counts (each count opens the Tasks page with a
 * filter), and a status update to publish on GitHub.
 */
export function ProjectHealth({
  api,
  groupId,
  board,
  onFilter,
  extraTiles,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  onFilter: (filter: { status?: string; repository?: string }) => void;
  /** More counts after the status counts, each with its own action. */
  extraTiles?: { label: string; count: number; run: () => void }[];
}) {
  const [body, setBody] = useState(''),
    [snapshot, setSnapshot] = useState<TrackerBoard>(),
    [status, setStatus] = useState<HealthStatus>('ON_TRACK'),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [published, setPublished] = useState(false);
  const pending = useRef(false);
  const counts = projectHealthCounts(board);
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
  const tiles = [
    ...counts.filter((row) => row.label !== 'No status' || row.count > 0),
    ...(extraTiles || []),
  ];
  return (
    <section aria-label="Board health" className="grid gap-4">
      <ul className="insight-tiles" aria-label="Task counts">
        {tiles.map((row) => (
          <li key={row.label}>
            <button
              type="button"
              className="insight-tile"
              disabled={row.count === 0}
              aria-label={`${row.count} ${row.label.toLowerCase()}: show the tasks`}
              onClick={() => ('run' in row ? row.run() : onFilter(row.filter))}
            >
              <span className="insight-tile-value">{row.count}</span>
              <span className="insight-tile-label">{row.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Project health"
          value={status}
          onChange={setStatus}
          className="w-fit max-w-full flex-wrap"
          options={healthStatuses.map((option) => ({
            value: option.value,
            label: option.label,
            disabled: busy || published,
            icon: (
              <span
                aria-hidden="true"
                className="health-dot"
                style={{ background: option.color }}
              />
            ),
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
