import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProjects } from '../electron/github-projects';
const project = {
  id: 'P',
  title: 'Project',
  url: 'https://github.com/users/test/projects/1',
  owner: 'test',
  number: 1,
};
const response = (title: string) => ({
  node: {
    fields: { nodes: [{ id: 'status', name: 'Status', options: [{ id: 'todo', name: 'Todo' }] }] },
    items: {
      nodes: [{ id: 'item', content: { title }, fieldValues: { nodes: [] } }],
      pageInfo: { hasNextPage: false },
    },
  },
});

test('board cache isolates credentials, shares reads, invalidates uncertain mutations, and never caches failed reads', async () => {
  let account = 'alice',
    reads = 0,
    rejectAuth = false;
  const service = new GitHubProjects(
    async (query) => {
      if (query.startsWith('mutation')) throw Error('Transport lost after send');
      reads++;
      return response(account);
    },
    async () => {
      if (rejectAuth) throw Error('signed out');
      return account;
    },
  );
  const [a, b] = await Promise.all([service.board(project), service.board(project)]);
  assert.equal(reads, 1);
  assert.equal(a.cache?.revision, b.cache?.revision);
  a.items[0].title = 'modified';
  assert.equal((await service.board(project)).items[0].title, 'alice');
  assert.equal(service.cacheMetrics.coalesced, 1);
  account = 'bob';
  assert.equal((await service.board(project)).items[0].title, 'bob');
  assert.equal(reads, 2);
  await assert.rejects(service.addDraft(project, 'Task', 'Description'), /Transport lost/);
  await service.board(project);
  assert.equal(reads, 3);
  rejectAuth = true;
  await assert.rejects(service.board(project), /signed out/);
  rejectAuth = false;
  await service.board(project);
  assert.equal(reads, 4);
  await Promise.all([service.board(project, true), service.board(project, true)]);
  assert.equal(reads, 5);
});

test('an in-flight board from a changed account or invalidated project cannot reach a window', async () => {
  let account = 'alice';
  const pending: ((value: unknown) => void)[] = [];
  const service = new GitHubProjects(
    () => new Promise((resolve) => pending.push(resolve)),
    async () => account,
  );
  const first = service.board(project);
  const rejected = assert.rejects(first, /changed/);
  while (!pending.length) await Promise.resolve();
  account = 'bob';
  const second = service.board(project);
  while (pending.length < 2) await Promise.resolve();
  pending[0](response('Alice private board'));
  pending[1](response('Bob board'));
  await rejected;
  assert.equal((await second).items[0].title, 'Bob board');
  const third = service.board(project, true);
  const invalidated = assert.rejects(third, /changed/);
  while (pending.length < 3) await Promise.resolve();
  service.invalidateBoards();
  pending[2](response('Old board'));
  await invalidated;
});

test('invalidating a pending identity check discards its board request before reading private data', async () => {
  let identify!: (account: string) => void;
  let reads = 0;
  const service = new GitHubProjects(
    async () => {
      reads++;
      return response('private');
    },
    () =>
      new Promise((resolve) => {
        identify = resolve;
      }),
  );
  const pending = service.board(project);
  const rejection = assert.rejects(pending, /access changed/);
  service.invalidateBoards();
  identify('old-account');
  await rejection;
  assert.equal(reads, 0);
  const fresh = service.board(project);
  identify('new-account');
  assert.equal((await fresh).items.length, 1);
  assert.equal(reads, 1);
});
