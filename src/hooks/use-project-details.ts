import { useEffect, useState, useSyncExternalStore } from 'react';
import type { API } from '../api/contracts';
import type { Project, RepositorySnapshot } from '../domain/project';
import { ProjectLoadCache } from '../domain/project-loading';

const identity = (project: Project) =>
  JSON.stringify([project.id, project.hostId ?? '', project.path]);
export function useProjectDetails(
  api: API,
  projects: Project[],
  selected: string,
  active: boolean,
  revision: number,
  detailRevision: number,
) {
  const [cache] = useState(() => new ProjectLoadCache<RepositorySnapshot>());
  const project = projects.find((p) => p.id === selected);
  const key = project ? identity(project) : '';
  const state = useSyncExternalStore(cache.subscribe, () => cache.read(key));
  useEffect(() => {
    cache.retain(new Set(projects.map(identity)));
  }, [cache, projects]);
  useEffect(() => {
    cache.invalidate();
  }, [cache, api, revision, detailRevision]);
  useEffect(() => {
    if (!active || !key) return;
    const update = (force = false) => {
      if (document.visibilityState !== 'hidden')
        void cache.load(key, () => api.repositorySnapshot(selected), force);
    };
    update();
    const focus = () => update(true);
    const visible = () => update();
    const timer = window.setInterval(() => update(), 15000);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cache, api, key, selected, active, revision, detailRevision]);
  return state;
}
