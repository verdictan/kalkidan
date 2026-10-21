import type { GitHubProject, GitHubOwner } from '../../src/types';
import { githubDescriptor, type TrackerProject, type TrackerOwner } from '../../src/domain/tracker';
import type { TrackerProvider } from './registry';
import type { GitHubProjects } from '../github-projects';
import type { GitHubAuth } from '../github-auth';
import { journalDetail } from './github-journal';
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
    portfolio: (values) => projects.portfolio(values.map(project)),
    docsPlan: (value, plan) => projects.docsPlan(project(value), plan),
    mutationHistory: (value, reviewedId) => projects.mutationHistory(project(value), reviewedId),
    batch: (value, request) => projects.batch(project(value), request),
    savedView: (value, viewId) =>
      projects.withAccount(() => projects.views.read(project(value), viewId)),
    content: (value, item) =>
      projects.withAccount(() => projects.content.read(project(value), item)),
    contentChange: (value, item, revision, action) =>
      projects.withWrite(project(value), () =>
        journalDetail.run({ itemId: item }, () =>
          projects.content.change(project(value), item, revision, action),
        ),
      ),
    relations: (value, item) =>
      projects.withAccount(() => projects.relations.read(project(value), item)),
    relationChange: (value, item, revision, action) =>
      projects.withWrite(project(value), () =>
        journalDetail.run({ itemId: item }, () =>
          projects.relations.change(project(value), item, revision, action),
        ),
      ),
    resources: (value, kind) =>
      projects.withAccount(() => projects.resources.read(project(value), kind)),
    resourceChange: (value, revision, operation, input) =>
      projects.withWrite(project(value), () =>
        projects.resources.change(project(value), revision, operation, input),
      ),
    projectAction: (value, revision, action) =>
      projects.withWrite(project(value), () =>
        projects.settings.administer(project(value), revision, action),
      ),
    settings: (value) => projects.withAccount(() => projects.settings.read(project(value))),
    settingsUpdate: (value, revision, action) =>
      projects.withWrite(project(value), () =>
        projects.settings.update(project(value), revision, action),
      ),
    field: (value, item, field, input) => projects.writeField(project(value), item, field, input),
    revertMutation: (value, mutationId) => projects.revertMutation(project(value), mutationId),
    itemAction: (value, item, action) =>
      projects.withWrite(project(value), () =>
        journalDetail.run({ itemId: item }, () =>
          projects.mutations.item(project(value), item, action),
        ),
      ),
    authorize: (force) => {
      projects.invalidateBoards();
      return auth.start(force === true);
    },
    authStatus: () => auth.inspect(),
    cancelAuth: (attemptId) => {
      projects.invalidateBoards();
      return auth.cancel(attemptId);
    },
    openAuth,
    owners: () => projects.withAccount(() => projects.owners()),
    projects: (value) => projects.withAccount(() => projects.list(owner(value))),
    resolve: (url) => projects.withAccount(() => projects.resolve(url)),
    createProject: (value, title) =>
      projects.withAccount(() => projects.create(owner(value), title)),
    board: (value, force) => projects.withAccount(() => projects.board(project(value), force)),
    setStatus: (value, item, status) =>
      projects.withWrite(project(value), () => projects.setStatus(project(value), item, status)),
    createItem: (value, title, body) =>
      projects.withWrite(project(value), () => projects.addDraft(project(value), title, body)),
    importItem: (value, url) =>
      projects.withWrite(project(value), () => projects.addIssue(project(value), url)),
  };
}
