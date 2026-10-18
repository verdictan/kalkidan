import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeTaskStatus } from '../src/lib/task-status';
import type { API, GitHubBoard, ProjectGroup } from '../src/types';
const group: ProjectGroup = {
  id: 'g1',
  name: 'Platform',
  repoIds: ['r1'],
  github: { id: 'gh', title: 'Roadmap', owner: 'org', number: 1, url: '' },
};
function fixture() {
  const calls: unknown[] = [];
  const board: GitHubBoard = {
    project: group.github!,
    items: [{ id: 'task', title: 'Build it', body: '', statusId: 'todo' }],
    statusField: {
      id: 'field',
      options: [
        { id: 'progress', name: 'In progress' },
        { id: 'done', name: 'Done' },
      ],
    },
  };
  const api = {
    githubBoard: async () => board,
    githubStatus: async (...args: unknown[]) => {
      calls.push(args);
    },
  } as unknown as API;
  return { board, api, calls };
}
test('task lifecycle resolves real GitHub options and skips redundant writes', async () => {
  const { api, calls, board } = fixture();
  await changeTaskStatus(api, group, 'task', 'progress');
  assert.deepEqual(calls, [['g1', 'task', 'progress']]);
  board.items[0].statusId = 'progress';
  await changeTaskStatus(api, group, 'task', 'progress');
  assert.equal(calls.length, 1);
  await changeTaskStatus(api, group, 'task', 'done');
  assert.deepEqual(calls[1], ['g1', 'task', 'done']);
});
test('missing tasks, missing status options and disconnected projects never write', async () => {
  const { api, calls, board } = fixture();
  await assert.rejects(changeTaskStatus(api, undefined, 'task', 'progress'), /Connect/);
  await assert.rejects(changeTaskStatus(api, group, 'removed', 'progress'), /removed or archived/);
  board.statusField!.options = [{ id: 'custom', name: 'In review' }];
  await assert.rejects(changeTaskStatus(api, group, 'task', 'progress'), /no “In progress” status/);
  assert.deepEqual(calls, []);
});
