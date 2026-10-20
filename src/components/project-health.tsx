import { useRef, useState } from 'react';
import type { API, TrackerBoard } from '../types';
import { projectHealthReport } from '../domain/project-health';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { errorMessage } from '../lib/errors';
export function ProjectHealth({ api, groupId }: { api: API; groupId: string }) {
  const [body, setBody] = useState(''),
    [snapshot, setSnapshot] = useState<TrackerBoard>(),
    [status, setStatus] = useState('ON_TRACK'),
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
    try {
      const board = await api.trackerBoard(groupId, true);
      setSnapshot(board);
      setBody(projectHealthReport(board, Date.now()));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function publish() {
    if (!snapshot || pending.current || error || published) return;
    pending.current = true;
    setBusy(true);
    try {
      const current = await api.trackerBoard(groupId, true);
      if (!current.cache?.revision || current.cache.revision !== snapshot.cache?.revision)
        throw new Error('The board changed. Prepare a new snapshot before publishing.');
      const updates = await api.trackerResources(groupId, 'statusUpdates');
      await api.trackerResourceChange(groupId, updates.revision, 'createProjectV2StatusUpdate', {
        body,
        status,
      });
      setPublished(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="border-t py-3">
      <summary>Project health report</summary>
      <div className="grid gap-3 py-3">
        <p className="help-text">
          Review a snapshot of status and repository workload before publishing it to GitHub.
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void prepare()}>
          Prepare current snapshot
        </Button>
        {body && (
          <>
            <Textarea
              aria-label="Project health report preview"
              value={body}
              maxLength={20000}
              onChange={(event) => setBody(event.target.value)}
              disabled={busy || published}
            />
            <label className="form-label">
              Project health
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={busy || published}
              >
                {['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'INACTIVE', 'COMPLETE'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy || !!error || published || !body.trim() || !snapshot?.writable}
              onClick={() => void publish()}
            >
              Publish status update
            </Button>
          </>
        )}
        {error && (
          <p role="alert">
            {error} Check GitHub before preparing another report if the result is uncertain.
          </p>
        )}
        {published && <p role="status">Status update published on GitHub.</p>}
      </div>
    </details>
  );
}
