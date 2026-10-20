import { useEffect, useState } from 'react';
import type { API } from '../types';
import type { SavedProjectView } from '../domain/github-resources';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';

export function GitHubSavedViews({
  api,
  groupId,
  revision,
  onChange,
}: {
  api: API;
  groupId: string;
  revision?: string;
  onChange: (view: SavedProjectView | null, pending: boolean) => void;
}) {
  const [views, setViews] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    if (selected) onChange(null, true);
    void api
      .trackerResources(groupId, 'views')
      .then(async (snapshot) => {
        if (!active) return;
        setViews(
          snapshot.records.map((record) => ({ id: String(record.id), name: String(record.name) })),
        );
        if (!selected) {
          onChange(null, false);
          return;
        }
        const view = await api.trackerSavedView(groupId, selected);
        if (active) onChange(view, false);
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, groupId, revision, selected, attempt, onChange]);
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <label className="form-label m-0">
        GitHub view
        <select
          aria-label="GitHub saved view"
          value={selected}
          disabled={busy}
          onChange={(event) => {
            setSelected(event.target.value);
            onChange(null, !!event.target.value);
          }}
        >
          <option value="">All project items</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => setAttempt((value) => value + 1)}
      >
        Refresh views
      </Button>
      {busy && <span role="status">Loading GitHub view…</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
