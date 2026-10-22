import { useCallback, useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import type { API } from '../types';
import type { SavedProjectView } from '../domain/github-resources';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './ui/dropdown-menu';
import { menuShortcutClass } from './ui/menu-styles';
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

/** The saved views of a board and the chosen view, for the board "⋯" menu. */
export interface SavedViews {
  views: SavedViewSummary[];
  /** The ID of the chosen view. Empty for all tasks. */
  selected: string;
  choose: (id: string) => void;
  /** The error of the last load. The menu then shows "Views could not load · Retry". */
  error: string;
  busy: boolean;
  retry: () => void;
}

/**
 * Loads the saved GitHub views of a board and keeps the choice for each project. The board
 * "⋯" menu shows them (`SavedViewsMenu`). A change of `reload` loads the views again. With
 * `enabled` false, nothing loads.
 */
export function useSavedViews({
  api,
  groupId,
  revision,
  reload = 0,
  enabled = true,
  onChange,
}: {
  api: API;
  groupId: string;
  revision?: string;
  /** A counter. Each change loads the views again. */
  reload?: number;
  enabled?: boolean;
  onChange: (view: SavedProjectView | null, pending: boolean) => void;
}): SavedViews {
  const [views, setViews] = useState<SavedViewSummary[]>(() => readSavedViewList(groupId));
  const [selected, setSelected] = useState(() => read(choiceKey(groupId)) || '');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choose = useCallback(
    (id: string) => {
      setSelected(id);
      write(choiceKey(groupId), id);
      onChange(null, !!id);
    },
    [groupId, onChange],
  );
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
    if (!enabled) return;
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
  }, [api, groupId, revision, selected, attempt, reload, enabled, onChange]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { views, selected, choose, error, busy, retry };
}

/**
 * "Saved view: All tasks ›" for the board "⋯" menu. When the views do not load, the item is
 * "Views could not load · Retry". With only the default view, nothing shows.
 */
export function SavedViewsMenu({ value }: { value: SavedViews }) {
  const { views, selected, choose, error, retry } = value;
  if (error)
    return (
      <DropdownMenuItem
        title={error}
        onSelect={(event) => {
          event.preventDefault();
          retry();
        }}
      >
        <Bookmark className="size-4" />
        Views could not load
        <span className={menuShortcutClass}>Retry</span>
      </DropdownMenuItem>
    );
  if (!views.length) return null;
  const current = views.find((view) => view.id === selected)?.name || 'All tasks';
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Bookmark className="size-4" />
        <span className="min-w-0 truncate">Saved view: {current}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-80">
        <DropdownMenuRadioGroup
          value={selected || allItems}
          onValueChange={(id) => choose(id === allItems ? '' : id)}
        >
          <DropdownMenuRadioItem value={allItems}>All tasks</DropdownMenuRadioItem>
          {views.map((view) => (
            <DropdownMenuRadioItem key={view.id} value={view.id}>
              <span className="truncate">{view.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
