import { trackerConnection } from '../domain/tracker';
import { trackerClient } from './tracker-client';
import type { API, ProjectGroup } from '../types';

// Status names come from the project's real options, never invented option IDs.
export async function changeTaskStatus(
  api: API,
  group: ProjectGroup | undefined,
  taskId: string,
  phase: 'progress' | 'done',
) {
  const connection = trackerConnection(group);
  if (!group || !connection)
    throw new Error('Connect a GitHub Projects board to this project to update its task.');
  const client = trackerClient(api, connection.provider);
  const descriptor = (await client.providers()).find((p) => p.id === connection.provider);
  if (!descriptor?.capabilities.updateStatus)
    throw new Error('This board does not support status changes.');
  const board = await client.board(group.id, true);
  const item = board.items.find((item) => item.id === taskId);
  if (!item) throw new Error('The linked task was removed or archived. Refresh the board.');
  const name = descriptor.statusNames[phase];
  const configured = connection.statusMapping?.[phase];
  const option = board.statusField?.options.find((option) =>
    configured ? option.id === configured : option.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (!option)
    throw new Error(
      `The board has no “${name}” status. Change the status of the task on the board.`,
    );
  if (item.statusId !== option.id) await client.status(group.id, taskId, option.id);
  return item.title;
}
