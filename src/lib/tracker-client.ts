import type { API, GitHubOwner, TrackerOwner } from '../types';
import { githubDescriptor } from '../domain/tracker';
/** Compatibility boundary for preview fixtures and older desktop bridges only. */
export function trackerClient(api: API, provider = 'github') {
  function legacy<T>(fn: () => T): T {
    if (provider !== 'github')
      throw new Error(`Tracker ${provider} requires the current desktop app.`);
    return fn();
  }
  return {
    providers: () =>
      api.trackerProviders ? api.trackerProviders() : Promise.resolve([githubDescriptor]),
    authorize: (force?: boolean) =>
      api.trackerAuthStart
        ? api.trackerAuthStart(provider, force)
        : legacy(() => api.githubAuthStart(force)),
    authStatus: () =>
      api.trackerAuthStatus
        ? api.trackerAuthStatus(provider)
        : legacy(() => api.githubAuthStatus()),
    cancelAuth: () =>
      api.trackerAuthCancel
        ? api.trackerAuthCancel(provider)
        : legacy(() => api.githubAuthCancel()),
    openAuth: () =>
      api.trackerAuthOpen ? api.trackerAuthOpen(provider) : legacy(() => api.githubAuthOpen()),
    owners: () =>
      api.trackerOwners ? api.trackerOwners(provider) : legacy(() => api.githubOwners()),
    projects: (owner: TrackerOwner) =>
      api.trackerProjects
        ? api.trackerProjects(provider, owner)
        : legacy(() => api.githubProjects(owner as GitHubOwner)),
    createProject: (owner: TrackerOwner, title: string) =>
      api.trackerCreateProject
        ? api.trackerCreateProject(provider, owner, title)
        : legacy(() => api.githubCreateProject(owner as GitHubOwner, title)),
    link: (id: string, reference: string) =>
      api.trackerLink
        ? api.trackerLink(id, provider, reference)
        : legacy(() => api.githubLink(id, reference)),
    board: (id: string) =>
      api.trackerBoard ? api.trackerBoard(id) : legacy(() => api.githubBoard(id)),
    status: (id: string, item: string, status: string) =>
      api.trackerStatus
        ? api.trackerStatus(id, item, status)
        : legacy(() => api.githubStatus(id, item, status)),
    draft: (id: string, title: string, body: string) =>
      api.trackerDraft
        ? api.trackerDraft(id, title, body)
        : legacy(() => api.githubDraft(id, title, body)),
    importItem: (id: string, url: string) =>
      api.trackerAddIssue
        ? api.trackerAddIssue(id, url)
        : legacy(() => api.githubAddIssue(id, url)),
  };
}
