import type { GitHubProject, GitHubOwner } from '../../src/types';
import { githubDescriptor, type TrackerProject, type TrackerOwner } from '../../src/domain/tracker';
import type { TrackerProvider } from './registry';
import type { GitHubProjects } from '../github-projects';
import type { GitHubAuth } from '../github-auth';
function project(value: TrackerProject): GitHubProject {
  if (!value.owner || !Number.isInteger(value.number))
    throw new Error('Invalid GitHub project reference');
  return value as GitHubProject;
}
function owner(value: TrackerOwner): GitHubOwner {
  if (!value || !['user', 'organization'].includes(value.kind))
    throw new Error('Invalid GitHub owner');
  return value as GitHubOwner;
}
export function githubTracker(
  projects: GitHubProjects,
  auth: GitHubAuth,
  openAuth: () => Promise<void>,
): TrackerProvider {
  return {
    descriptor: githubDescriptor,
    authorize: (force) => auth.start(force === true),
    authStatus: () => auth.inspect(),
    cancelAuth: () => auth.cancel(),
    openAuth,
    owners: () => projects.owners(),
    projects: (value) => projects.list(owner(value)),
    resolve: (url) => projects.resolve(url),
    createProject: (value, title) => projects.create(owner(value), title),
    board: (value) => projects.board(project(value)),
    setStatus: (value, item, status) => projects.setStatus(project(value), item, status),
    createItem: (value, title, body) => projects.addDraft(project(value), title, body),
    importItem: (value, url) => projects.addIssue(project(value), url),
  };
}
