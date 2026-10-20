import { useRef, useState } from 'react';
import type { API } from '../types';
import type { GitHubMutationHistory } from '../domain/project-batch';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
export function GitHubWriteHistory({
  api,
  groupId,
  url,
}: {
  api: API;
  groupId: string;
  url: string;
}) {
  const [rows, setRows] = useState<GitHubMutationHistory>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reviewed, setReviewed] = useState<string[]>([]);
  const pending = useRef(false);
  async function load(id?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setRows(await api.trackerMutationHistory(groupId, id));
      if (id) setReviewed((values) => values.filter((value) => value !== id));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="border-t py-3"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>GitHub write history</summary>
      <div className="grid gap-3 py-3">
        <p className="help-text">
          Uncertain writes are not sent again. Check the resulting data on GitHub before marking an
          operation reviewed. This records your review; it does not claim the write succeeded.
        </p>
        <a href={url} target="_blank" rel="noreferrer">
          Open project on GitHub
        </a>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          Refresh write history
        </Button>
        {!rows.length && !busy && !error && <p>No recorded writes for this project.</p>}
        {[...rows].reverse().map((row) => (
          <div key={row.id} className="grid gap-2 border-b pb-3">
            <p>
              {row.operation} · {row.state} · {new Date(row.updatedAt).toLocaleString()}
            </p>
            {row.state === 'unknown-outcome' && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={reviewed.includes(row.id)}
                    disabled={busy}
                    onChange={(event) =>
                      setReviewed(
                        event.target.checked
                          ? [...reviewed, row.id]
                          : reviewed.filter((id) => id !== row.id),
                      )
                    }
                  />{' '}
                  I inspected the result on GitHub.
                </label>
                <Button
                  variant="outline"
                  disabled={busy || !reviewed.includes(row.id)}
                  onClick={() => void load(row.id)}
                >
                  Record review
                </Button>
              </>
            )}
          </div>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
