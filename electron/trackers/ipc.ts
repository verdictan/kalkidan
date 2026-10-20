import type { ProjectGroups } from '../project-groups';
import { trackerConnection } from '../../src/domain/tracker';
import type { TrackerRegistry } from './registry';
// The main process supplies the sender-validated IPC registrar.
export function registerTrackerHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  registry: TrackerRegistry,
  groups: ProjectGroups,
) {
  const linked = (id: string) =>
    registry.linked(trackerConnection(groups.groups.find((g) => g.id === id)));
  handle('tracker-portfolio', async (ids) => {
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 20 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string')
    )
      throw new Error('Select between 1 and 20 projects.');
    const references = ids.map((id) => linked(id));
    const provider = references[0].provider;
    if (!provider.portfolio || references.some((reference) => reference.provider !== provider))
      throw new Error('Choose connected GitHub projects.');
    const results = await provider.portfolio(references.map((reference) => reference.project));
    return results.map((result, index) => ({ ...result, groupId: ids[index] }));
  });
  handle('tracker-docs-plan', (id, plan) => {
    const { provider, project } = linked(id);
    if (!provider.docsPlan) throw new Error('Docs planning is not available.');
    return provider.docsPlan(project, plan);
  });
  handle('tracker-mutation-history', (id, reviewedId) => {
    const { provider, project } = linked(id);
    if (!provider.mutationHistory) throw new Error('Mutation history is not available.');
    return provider.mutationHistory(project, reviewedId);
  });
  handle('tracker-batch', (id, request) => {
    const { provider, project } = linked(id);
    if (!provider.batch) throw new Error('Batch editing is not available.');
    return provider.batch(project, request);
  });
  handle('tracker-saved-view', (id, viewId) => {
    const { provider, project } = linked(id);
    if (!provider.savedView) throw new Error('Saved views are not available.');
    return provider.savedView(project, viewId);
  });
  handle('tracker-content', (id, item) => {
    const { provider, project } = linked(id);
    if (!provider.content) throw new Error('Content editing is not available.');
    return provider.content(project, item);
  });
  handle('tracker-content-change', (id, item, revision, action) => {
    const { provider, project } = linked(id);
    if (!provider.contentChange) throw new Error('Content editing is not available.');
    return provider.contentChange(project, item, revision, action);
  });
  handle('tracker-relations', (id, item) => {
    const { provider, project } = linked(id);
    if (!provider.relations) throw new Error('Issue relationships are not available.');
    return provider.relations(project, item);
  });
  handle('tracker-relation-change', (id, item, revision, action) => {
    const { provider, project } = linked(id);
    if (!provider.relationChange) throw new Error('Issue relationships are not available.');
    return provider.relationChange(project, item, revision, action);
  });
  handle('tracker-project-action', (id, revision, action) => {
    const { provider, project } = linked(id);
    if (!provider.projectAction) throw new Error('Project administration is not available.');
    return provider.projectAction(project, revision, action);
  });
  handle('tracker-resources', (id, kind) => {
    const { provider, project } = linked(id);
    if (!provider.resources) throw new Error('Project resources are not available.');
    return provider.resources(project, kind);
  });
  handle('tracker-resource-change', (id, revision, operation, input) => {
    const { provider, project } = linked(id);
    if (!provider.resourceChange) throw new Error('Project resources are not available.');
    return provider.resourceChange(project, revision, operation, input);
  });
  handle('tracker-settings', (id) => {
    const { provider, project } = linked(id);
    if (!provider.settings) throw new Error('Project settings are not available.');
    return provider.settings(project);
  });
  handle('tracker-settings-update', (id, revision, action) => {
    const { provider, project } = linked(id);
    if (!provider.settingsUpdate) throw new Error('Project settings are not available.');
    return provider.settingsUpdate(project, revision, action);
  });
  handle('tracker-field', (id, item, field, value) => {
    const { provider, project } = linked(id);
    if (!provider.field) throw new Error('Field editing is not supported by this tracker.');
    return provider.field(project, item, field, value);
  });
  handle('tracker-item-action', (id, item, action) => {
    const { provider, project } = linked(id);
    if (!provider.itemAction) throw new Error('Item actions are not supported by this tracker.');
    return provider.itemAction(project, item, action);
  });
  handle('tracker-providers', () => registry.list());
  handle('tracker-auth-start', (id, force) => registry.get(id).authorize(force === true));
  handle('tracker-auth-status', (id) => registry.get(id).authStatus());
  handle('tracker-auth-cancel', (id, attemptId) =>
    registry.get(id).cancelAuth(typeof attemptId === 'string' ? attemptId : ''),
  );
  handle('tracker-auth-open', (id) => registry.get(id).openAuth());
  handle('tracker-owners', (id) => registry.get(id).owners());
  handle('tracker-projects', (id, owner) => registry.get(id).projects(owner));
  handle('tracker-create-project', (id, owner, title) =>
    registry.require(id, 'createProject').createProject(owner, title),
  );
  handle('tracker-link', async (groupId, id, reference) => {
    if (!groups.groups.some((g) => g.id === groupId)) throw new Error('Project not found');
    const project = await registry.get(id).resolve(reference);
    await groups.connect(groupId, { provider: id, project });
  });
  handle('tracker-board', (id, force) => {
    const { provider, project } = linked(id);
    return provider.board(project, force === true);
  });
  handle('tracker-status', (id, item, status) => {
    const { provider, project } = linked(id);
    return registry
      .require(provider.descriptor.id, 'updateStatus')
      .setStatus(project, item, status);
  });
  handle('tracker-draft', (id, title, body) => {
    const { provider, project } = linked(id);
    return registry.require(provider.descriptor.id, 'createItem').createItem(project, title, body);
  });
  handle('tracker-add-issue', (id, reference) => {
    const { provider, project } = linked(id);
    return registry.require(provider.descriptor.id, 'importItem').importItem(project, reference);
  });
  handle('tracker-configure', async (id, mapping, statusFieldId) => {
    const { provider, project } = linked(id);
    if (
      !mapping ||
      typeof mapping !== 'object' ||
      Object.keys(mapping).some((key) => !['progress', 'done'].includes(key))
    )
      throw new Error('Invalid task status mapping');
    if (
      statusFieldId !== undefined &&
      (typeof statusFieldId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(statusFieldId))
    )
      throw new Error('Invalid workflow field');
    const board = await provider.board(
      statusFieldId ? { ...project, statusFieldId } : project,
      true,
    );
    if (statusFieldId && board.statusField?.id !== statusFieldId)
      throw new Error('Select a single-select field from this project.');
    for (const value of Object.values(mapping))
      if (typeof value !== 'string' || !board.statusField?.options.some((o) => o.id === value))
        throw new Error('Select a status from this tracker');
    await groups.configure(id, mapping, statusFieldId);
  });
}
