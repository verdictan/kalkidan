import { useEffect, useState } from 'react';

/** A chat, task, doc page or repo that the user opened. Search lists them under Recent. */
export interface RecentItem {
  kind: 'chat' | 'task' | 'doc' | 'repo';
  id: string;
  title: string;
  /** The project of a task or a page. */
  groupId?: string;
  /** The agent and host of a chat. */
  agent?: string;
  hostId?: string;
  /** When the user opened it, in milliseconds. */
  at: number;
}

const storageKey = 'kalkidan-recent-items';
const changeEvent = 'kalkidan-recent-items';
const limit = 30;
const keyOf = (item: Pick<RecentItem, 'kind' | 'id' | 'agent' | 'groupId'>) =>
  [item.kind, item.groupId || '', item.agent || '', item.id].join(':');

export function readRecentItems(): RecentItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value)
      ? value.filter(
          (item): item is RecentItem =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as RecentItem).id === 'string' &&
            typeof (item as RecentItem).title === 'string' &&
            ['chat', 'task', 'doc', 'repo'].includes((item as RecentItem).kind),
        )
      : [];
  } catch {
    return [];
  }
}

/** Puts an item first in the recent list. An item that is there already moves up. */
export function recordRecentItem(item: Omit<RecentItem, 'at'>) {
  if (!item.id || item.id.startsWith('draft-')) return;
  const key = keyOf(item);
  const next = [
    { ...item, at: Date.now() },
    ...readRecentItems().filter((entry) => keyOf(entry) !== key),
  ].slice(0, limit);
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* The list then holds this run only. */
  }
  window.dispatchEvent(new CustomEvent(changeEvent));
}

/** The recent items, newest first. The list updates when an item opens. */
export function useRecentItems(): RecentItem[] {
  const [items, setItems] = useState(readRecentItems);
  useEffect(() => {
    const update = () => setItems(readRecentItems());
    window.addEventListener(changeEvent, update);
    return () => window.removeEventListener(changeEvent, update);
  }, []);
  return items;
}
