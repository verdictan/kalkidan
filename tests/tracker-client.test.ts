import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relinkTaskChats, revertIssuesToDrafts } from '../src/lib/tracker-client';
import type { Session } from '../src/types';

/** A tracker API that records each call. `fail` names the calls that throw. */
function tracker(fail: Partial<Record<string, string>> = {}, state = 'OPEN') {
  const calls: unknown[][] = [];
  let next = 0;
  const call = (name: string, args: unknown[]) => {
    calls.push([name, ...args]);
    if (fail[name] && (args[1] === fail[name] || fail[name] === '*'))
      throw new Error(`${name} failed`);
  };
  const api = {
    trackerContent: async (group: string, item: string) => {
      call('content', [group, item]);
      return {
        id: 'content-' + item,
        kind: 'Issue' as const,
        title: `Title ${item}`,
        body: `Body ${item}`,
        state,
        revision: 'rev-' + item,
        permissions: { edit: true, close: true, reopen: true, assign: true, label: true },
        assignees: [],
        labels: [],
        comments: [],
      };
    },
    trackerContentChange: async (group: string, item: string, revision: string, action: any) => {
      call('close', [group, item, revision, action]);
      return {} as any;
    },
    trackerDraft: async (group: string, title: string, body: string) => {
      call('draft', [group, title, body]);
      return `draft-${++next}`;
    },
    trackerStatus: async (group: string, item: string, status: string) => {
      call('status', [group, item, status]);
    },
    trackerItemAction: async (group: string, item: string, action: any) => {
      call('item', [group, item, action]);
    },
  };
  return { api, calls };
}

test('reverting an issue adds a draft in its column, closes the issue as not planned and removes it', async () => {
  const { api, calls } = tracker();
  const results = await revertIssuesToDrafts(api, 'g', [
    { itemId: 'I1', title: 'Old', body: '', statusId: 'progress' },
  ]);
  assert.deepEqual(results, [{ itemId: 'I1', draftId: 'draft-1' }]);
  assert.deepEqual(calls, [
    ['content', 'g', 'I1'],
    ['draft', 'g', 'Title I1', 'Body I1'],
    ['status', 'g', 'draft-1', 'progress'],
    ['close', 'g', 'I1', 'rev-I1', { kind: 'close', reason: 'not-planned' }],
    ['item', 'g', 'I1', { kind: 'remove' }],
  ]);
});

test('a closed issue is not closed again, and a draft without a status keeps the first column', async () => {
  const { api, calls } = tracker({}, 'CLOSED');
  const results = await revertIssuesToDrafts(api, 'g', [{ itemId: 'I1', title: 'T', body: '' }]);
  assert.equal(results[0].draftId, 'draft-1');
  assert.deepEqual(
    calls.map((row) => row[0]),
    ['content', 'draft', 'item'],
  );
});

test('when the issue does not close, the new draft is removed and the issue stays', async () => {
  const { api, calls } = tracker({ close: 'I1' });
  const results = await revertIssuesToDrafts(api, 'g', [
    { itemId: 'I1', title: 'A', body: '' },
    { itemId: 'I2', title: 'B', body: '' },
  ]);
  assert.deepEqual(results, [
    { itemId: 'I1', error: 'close failed' },
    { itemId: 'I2', draftId: 'draft-2' },
  ]);
  assert.deepEqual(calls[3], ['item', 'g', 'draft-1', { kind: 'remove' }]);
  assert.ok(!calls.some((row) => row[0] === 'item' && row[2] === 'I1'));
});

test('a failed column change keeps the draft and still closes the issue', async () => {
  const { api, calls } = tracker({ status: '*' });
  const results = await revertIssuesToDrafts(api, 'g', [
    { itemId: 'I1', title: 'A', body: '', statusId: 'done' },
  ]);
  assert.equal(results[0].draftId, 'draft-1');
  assert.ok(calls.some((row) => row[0] === 'close'));
});

test('a pull request is not changed back to a draft', async () => {
  const { api, calls } = tracker();
  api.trackerContent = (async (group: string, item: string) => ({
    ...(await tracker().api.trackerContent(group, item)),
    kind: 'PullRequest',
  })) as any;
  const results = await revertIssuesToDrafts(api, 'g', [{ itemId: 'P', title: 'A', body: '' }]);
  assert.match(results[0].error!, /not an issue/);
  assert.equal(calls.length, 0);
});

test('saved chats of the old task link to the new draft; unsaved chats keep their link', async () => {
  const updates: unknown[][] = [];
  const session = (id: string, taskId?: string) =>
    ({ id, agent: 'codex', organization: taskId ? { taskId } : {} }) as unknown as Session;
  await relinkTaskChats(
    {
      updateSession: async (...args: unknown[]) => {
        updates.push(args);
        if (args[1] === 's2') throw new Error('gone');
      },
    },
    [session('s1', 'I1'), session('s2', 'I1'), session('draft-x', 'I1'), session('s3', 'I9')],
    [
      { itemId: 'I1', draftId: 'D1' },
      { itemId: 'I9', error: 'failed' },
    ],
  );
  assert.deepEqual(updates, [
    ['codex', 's1', { taskId: 'D1' }],
    ['codex', 's2', { taskId: 'D1' }],
  ]);
});
