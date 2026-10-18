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
  handle('tracker-providers', () => registry.list());
  handle('tracker-auth-start', (id, force) => registry.get(id).authorize(force === true));
  handle('tracker-auth-status', (id) => registry.get(id).authStatus());
  handle('tracker-auth-cancel', (id) => registry.get(id).cancelAuth());
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
  handle('tracker-board', (id) => {
    const { provider, project } = linked(id);
    return provider.board(project);
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
  handle('tracker-configure', async (id, mapping) => {
    const { provider, project } = linked(id);
    if (
      !mapping ||
      typeof mapping !== 'object' ||
      Object.keys(mapping).some((key) => !['progress', 'done'].includes(key))
    )
      throw new Error('Invalid task status mapping');
    const board = await provider.board(project);
    for (const value of Object.values(mapping))
      if (typeof value !== 'string' || !board.statusField?.options.some((o) => o.id === value))
        throw new Error('Select a status from this tracker');
    await groups.configure(id, mapping);
  });
}
