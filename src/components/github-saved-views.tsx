import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { API } from '../types';
import type { SavedProjectView } from '../domain/github-resources';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Hint } from './hint';
import { errorMessage } from '../lib/errors';

export interface SavedViewSummary {
  id: string;
  name: string;
}

const allItems = '__all';
function choiceKey(groupId: string) {
  return `kalkidan-saved-view:${groupId}`;
}
function listKey(groupId: string) {
  return `kalkidan-saved-views:${groupId}`;
}
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable. The choice then resets on the next visit.
  }
}

/**
 * The saved GitHub views of a project, from the last time the board loaded them. The command
 * palette uses this list for "View: <name>". Open a view with the event
 * `kalkidan-open-saved-view` {groupId, viewId}.
 */
export function readSavedViewList(groupId: string): SavedViewSummary[] {
  try {
    const value = JSON.parse(read(listKey(groupId)) || '[]');
    return Array.isArray(value)
      ? value.filter(
          (view): view is SavedViewSummary =>
            typeof view?.id === 'string' && typeof view?.name === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/** Opens a saved GitHub view on the Tasks page of a project. An empty ID shows all items. */
export function openSavedView(groupId: string, viewId: string) {
  write(choiceKey(groupId), viewId);
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-saved-view', { detail: { groupId, viewId } }),
  );
}

/**
 * "View: All project items ▾" and a refresh button for the board toolbar. The choice is kept
 * for each project.
 */
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
  const [views, setViews] = useState<SavedViewSummary[]>(() => readSavedViewList(groupId));
  const [selected, setSelected] = useState(() => read(choiceKey(groupId)) || '');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function choose(id: string) {
    setSelected(id);
    write(choiceKey(groupId), id);
    onChange(null, !!id);
  }
  // The command palette and the sidebar open a view with this event.
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string; viewId?: string }>).detail;
      if (detail?.groupId === groupId && typeof detail.viewId === 'string') {
        setSelected(detail.viewId);
        onChange(null, !!detail.viewId);
      }
    };
    window.addEventListener('kalkidan-open-saved-view', handle);
    return () => window.removeEventListener('kalkidan-open-saved-view', handle);
  }, [groupId, onChange]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    if (selected) onChange(null, true);
    void api
      .trackerResources(groupId, 'views')
      .then(async (snapshot) => {
        if (!active) return;
        const list = snapshot.records.map((record) => ({
          id: String(record.id),
          name: String(record.name),
        }));
        setViews(list);
        write(listKey(groupId), JSON.stringify(list));
        window.dispatchEvent(
          new CustomEvent('kalkidan-saved-views', { detail: { groupId, views: list } }),
        );
        // A view that was removed on GitHub falls back to all items.
        if (!selected || !list.some((view) => view.id === selected)) {
          if (selected) {
            setSelected('');
            write(choiceKey(groupId), '');
          }
          onChange(null, false);
          return;
        }
        const view = await api.trackerSavedView(groupId, selected);
        if (active) onChange(view, false);
      })
      .catch((failure) => {
        if (!active) return;
        setError(errorMessage(failure));
        onChange(null, false);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, groupId, revision, selected, attempt, onChange]);
  const current = views.find((view) => view.id === selected);
  return (
    <div className="tracker-saved-views" role="group" aria-label="GitHub view">
      <Select
        value={selected || allItems}
        onValueChange={(value) => choose(value === allItems ? '' : value)}
      >
        <SelectTrigger
          size="sm"
          variant="filled"
          aria-label="GitHub saved view"
          className="tracker-saved-view-trigger"
          title={current?.name}
        >
          <span className="text-muted-foreground" aria-hidden="true">
            View:
          </span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" className="max-w-[calc(100vw-2rem)]">
          <SelectItem value={allItems}>All project items</SelectItem>
          {views.map((view) => (
            <SelectItem key={view.id} value={view.id}>
              {view.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Hint label={busy ? 'Loading GitHub views…' : 'Refresh GitHub views'}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh GitHub views"
          disabled={busy}
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw className={busy ? 'animate-spin' : undefined} />
        </Button>
      </Hint>
      <span className="sr-only" role="status">
        {busy ? 'Loading GitHub view…' : ''}
      </span>
      {error && (
        <Hint label={`Could not load the GitHub views. ${error}`}>
          <span className="tracker-saved-view-error" role="alert" tabIndex={0}>
            <AlertCircle size={14} aria-hidden="true" />
            <span className="sr-only">Could not load the GitHub views. {error}</span>
          </span>
        </Hint>
      )}
    </div>
  );
}
