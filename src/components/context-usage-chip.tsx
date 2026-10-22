import { useEffect, useState } from 'react';
import type { API } from '../types';
import type { ContextUsage } from '../domain/memory';

/**
 * Calls `read` now, when `key` changes, when the window gets focus, and when the memory or docs
 * of the project change.
 */
function useProjectReload(api: API, groupId: string, read: () => void, key = '') {
  useEffect(() => {
    read();
    const unsubscribe = api.onProjectResourceChange?.((event) => {
      if (event.groupId === groupId) read();
    });
    window.addEventListener('focus', read);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, groupId, key]);
}

/** How many chats read each memory fact and each doc page of a project. */
export function useReadCounts(api: API, groupId: string) {
  const [counts, setCounts] = useState<{
    memory: Record<string, number>;
    docs: Record<string, number>;
  }>();
  useProjectReload(api, groupId, () => {
    if (typeof api.readCounts !== 'function') return;
    void api
      .readCounts(groupId)
      .then(setCounts)
      .catch(() => setCounts(undefined));
  });
  return counts;
}

/**
 * The facts and pages that the agent read in one chat. It reads them again when the memory or
 * the docs of the project change. Undefined while not known or when the agent read nothing.
 */
export function useContextUsage(
  api: API,
  groupId: string | undefined,
  agent: string,
  /** The provider session ID of the chat. Empty: the chat is not saved yet. */
  sessionId: string,
  /** Increase it to read again, for example after a run. */
  version = 0,
) {
  const [usage, setUsage] = useState<ContextUsage>();
  useEffect(() => setUsage(undefined), [groupId, agent, sessionId]);
  useProjectReload(
    api,
    groupId || '',
    () => {
      if (!groupId || typeof api.contextUsage !== 'function' || !sessionId) return;
      void api
        .contextUsage(groupId, agent, sessionId)
        .then((value) => setUsage(value.memory.length || value.docs.length ? value : undefined))
        .catch(() => setUsage(undefined));
    },
    `${agent}:${sessionId}:${version}`,
  );
  return usage;
}
