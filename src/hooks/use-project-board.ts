import { useEffect, useSyncExternalStore } from 'react';
import type { API } from '../api/contracts';
import type { TrackerBoard, TrackerProject } from '../domain/tracker';
import { ProjectLoadCache } from '../domain/project-loading';
import type { trackerClient } from '../lib/tracker-client';

// Scope cache ownership to the API connection, including across panel remounts.
const caches = new WeakMap<API, ProjectLoadCache<TrackerBoard>>();
const revisions = new WeakMap<API, Map<string, number>>();
export function useProjectBoard(
  api: API,
  client: ReturnType<typeof trackerClient>,
  provider: string,
  groupId: string,
  project: TrackerProject | undefined,
  revision = 0,
) {
  let cache = caches.get(api);
  if (!cache) {
    cache = new ProjectLoadCache<TrackerBoard>();
    caches.set(api, cache);
  }
  let versions = revisions.get(api);
  if (!versions) {
    versions = new Map();
    revisions.set(api, versions);
  }
  const key = project ? JSON.stringify([provider, groupId, project.id, project.url]) : '';
  const state = useSyncExternalStore(cache.subscribe, () => cache.read(key));
  const refresh = async () => {
    if (!key) return;
    cache.invalidate(key);
    await cache.load(key, () => client.board(groupId, true), true);
    const next = cache.read(key);
    if (next.status === 'error') throw new Error(next.error);
    return next.value;
  };
  useEffect(() => {
    if (!key) return;
    if (versions.get(key) !== revision) {
      cache.invalidate(key);
      versions.set(key, revision);
      // Keep revision metadata bounded independently of cache eviction.
      while (versions.size > 24) versions.delete(versions.keys().next().value!);
    }
    const update = () => {
      if (document.visibilityState !== 'hidden') void cache.load(key, () => client.board(groupId));
    };
    const changed = () => {
      cache.invalidate(key);
      update();
    };
    const unsubscribe = api.onTrackerChange?.(changed);
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 15000);
    return () => {
      unsubscribe?.();
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [cache, versions, key, revision, client, groupId]);
  return { state, refresh };
}
