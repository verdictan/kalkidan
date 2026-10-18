import type { API, ProjectGroup } from '../types';

// Status names come from the project's real options, never invented option IDs.
export async function changeTaskStatus(api: API, group: ProjectGroup | undefined, taskId: string, phase: 'progress' | 'done') {
  if (!group?.github) throw new Error('Connect this repository’s project to GitHub to update its task.');
  const board = await api.githubBoard(group.id);
  const item = board.items.find(item => item.id === taskId);
  if (!item) throw new Error('The linked task was removed or archived. Refresh the tracker.');
  const name = phase === 'progress' ? 'In progress' : 'Done';
  const option = board.statusField?.options.find(option => option.name.trim().toLowerCase() === name.toLowerCase());
  if (!option) throw new Error(`This GitHub project has no “${name}” status. Update the task manually in the tracker.`);
  if (item.statusId !== option.id) await api.githubStatus(group.id, taskId, option.id);
  return item.title;
}
