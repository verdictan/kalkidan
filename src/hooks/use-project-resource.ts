import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { API } from '../api/contracts';
import type { ProjectGroup } from '../domain/project';
import { ProjectLoadCache, type ProjectLoadState } from '../domain/project-loading';

export type ProjectResource = 'docs-metadata' | 'docs-page' | 'memory';
const stores = new WeakMap<API, ProjectLoadCache<unknown>>();
const revisions = new WeakMap<API, Map<string, string>>();
function store(api: API) {
  let value = stores.get(api);
  if (!value) {
    value = new ProjectLoadCache<unknown>(15000, 40, Date.now, 16 * 1024 * 1024);
    stores.set(api, value);
  }
  return value;
}
export function projectResourceKey(group: ProjectGroup, kind: ProjectResource, page = '') {
  return JSON.stringify([group.hostId || '', group.rootPath || '', group.id, kind, page]);
}
export function setProjectResource<T>(
  api: API,
  group: ProjectGroup,
  kind: ProjectResource,
  value: T,
  page = '',
) {
  store(api).set(projectResourceKey(group, kind, page), value);
}
/** Drop old host/root identities and deleted projects, including pending responses. */
export function retainProjectResources(api: API, groups: ProjectGroup[]) {
  const identities = new Set(
    groups.map((group) => JSON.stringify([group.hostId || '', group.rootPath || '', group.id])),
  );
  const removed = (key: string) => !identities.has(JSON.stringify(JSON.parse(key).slice(0, 3)));
  stores.get(api)?.removeWhere(removed);
  for (const key of revisions.get(api)?.keys() || [])
    if (removed(key)) revisions.get(api)!.delete(key);
}
export function useProjectResource<T>(
  api: API,
  group: ProjectGroup,
  kind: ProjectResource,
  read: () => Promise<T>,
  page = '',
  enabled = true,
) {
  const cache = store(api);
  const key = projectResourceKey(group, kind, page);
  const fetch = useRef(read);
  fetch.current = read;
  async function reconcile() {
    if (!api.projectResourceRevision) return fetch.current();
    let versions = revisions.get(api);
    if (!versions) {
      versions = new Map();
      revisions.set(api, versions);
    }
    const revision = await api.projectResourceRevision(
      group.id,
      kind === 'memory' ? 'memory' : 'docs',
    );
    const previous = cache.read(key).value as T | undefined;
    if (versions.get(key) === revision && previous !== undefined) return previous;
    const result = await fetch.current();
    versions.set(key, revision);
    while (versions.size > 40) versions.delete(versions.keys().next().value!);
    return result;
  }
  const state = useSyncExternalStore(cache.subscribe, () => cache.read(key)) as ProjectLoadState<T>;
  useEffect(() => {
    if (!enabled) return;
    const load = (force = false) => {
      if (!document.hidden) void cache.load(key, reconcile, force);
    };
    const focus = () => load(true);
    const visibility = () => load();
    const changed = (event: { groupId: string; resource: 'docs' | 'memory' }) => {
      if (event.groupId !== group.id || (kind === 'memory') !== (event.resource === 'memory'))
        return;
      cache.invalidate(key);
      load();
    };
    const unsubscribe = api.onProjectResourceChange?.(changed);
    const reconnect = api.onRemoteHostsChange?.(focus);
    const timer = window.setInterval(visibility, 15000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    load();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe?.();
      reconnect?.();
    };
  }, [api, cache, key, enabled]);
  return {
    state,
    update: (change: T | ((value: T | undefined) => T)) => {
      const previous = cache.read(key).value as T | undefined;
      cache.set(
        key,
        typeof change === 'function' ? (change as (value: T | undefined) => T)(previous) : change,
      );
    },
    refresh: () => {
      cache.invalidate(key);
      return cache.load(key, () => fetch.current());
    },
  };
}
