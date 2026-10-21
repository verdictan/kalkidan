import { useEffect, useState } from 'react';
import { trackerConnection, type TrackerBoard, type TrackerItem } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import type { API, ProjectGroup, Session } from '../types';

/**
 * The boards of the connected projects, by project ID. The app uses them to show the task
 * of a chat ("#12") and the open task counts. A board that does not load is left out.
 */
export function useProjectBoards(api: API, groups: ProjectGroup[], revision = 0) {
  const [boards, setBoards] = useState<Record<string, TrackerBoard>>({});
  const key = groups
    .map((group) => {
      const connection = trackerConnection(group);
      return connection ? `${group.id}:${connection.provider}:${connection.project.id}` : '';
    })
    .filter(Boolean)
    .join('|');
  useEffect(() => {
    let live = true;
    const load = () => {
      for (const group of groups) {
        const connection = trackerConnection(group);
        if (!connection) continue;
        Promise.resolve()
          .then(() => trackerClient(api, connection.provider).board(group.id))
          .then((board) => {
            if (live) setBoards((current) => ({ ...current, [group.id]: board }));
          })
          .catch(() => {
            /* The board page shows the error. The other views leave the board out. */
          });
      }
    };
    load();
    const unsubscribe = api.onTrackerChange?.(load);
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [api, key, revision]);
  return boards;
}

/** The board item that a chat works on, from its link or from the draft that started it. */
export function sessionTask(
  session: Session,
  boards: Record<string, TrackerBoard>,
): TrackerItem | undefined {
  const id = session.organization?.taskId || session.task?.id;
  if (!id) return undefined;
  for (const board of Object.values(boards)) {
    const item = board.items.find((entry) => entry.id === id);
    if (item) return item;
  }
  return session.task;
}

/** True for a status name that means the work is complete. */
export const doneStatus = (name = '') => /done|complete|closed|shipped|merged/i.test(name);
/** True for a status name that means the work is in progress. */
export const progressStatus = (name = '') => /progress|doing|review|active/i.test(name);

/** The status name of a board item. */
export function itemStatus(board: TrackerBoard, item: TrackerItem) {
  return board.statusField?.options.find((option) => option.id === item.statusId)?.name || '';
}
