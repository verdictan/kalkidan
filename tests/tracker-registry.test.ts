import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrackerRegistry, type TrackerProvider } from '../electron/trackers/registry';
import { registerTrackerHandlers } from '../electron/trackers/ipc';
import { ProjectGroups } from '../electron/project-groups';
import { changeTaskStatus } from '../src/lib/task-status';
import type { API } from '../src/types';
function fixture() {
  const calls: unknown[] = [];
  const project = { id: 'team-board', title: 'Engineering', url: 'https://tracker.example/team' };
  const adapter: TrackerProvider = {
    descriptor: {
      id: 'example',
      name: 'Example Tracker',
      capabilities: {
        createProject: false,
        createItem: true,
        importItem: false,
        updateStatus: true,
      },
      statusNames: { progress: 'Building', done: 'Released' },
    },
    authorize: async () => ({ status: 'ready' }),
    authStatus: () => ({ status: 'ready' }),
    cancelAuth: () => ({ status: 'idle' }),
    openAuth: async () => {},
    owners: async () => [{ id: 'team', login: 'Engineering', kind: 'team' }],
    projects: async () => [project],
    resolve: async () => project,
    createProject: async () => {
      throw new Error('Must not call');
    },
    board: async () => ({
      project,
      items: [{ id: 'task', title: 'Implement feature', body: '', statusId: 'queued' }],
      statusField: {
        id: 'workflow',
        options: [
          { id: 'building', name: 'Building' },
          { id: 'released', name: 'Released' },
          { id: 'qa', name: 'QA' },
        ],
      },
    }),
    setStatus: async (...args) => {
      calls.push(args);
    },
    createItem: async (...args) => {
      calls.push(args);
    },
    importItem: async () => {
      throw new Error('Must not call');
    },
  };
  return { adapter, calls, project, registry: new TrackerRegistry([adapter], 'example') };
}
test('a non-GitHub adapter supports storage, board, mutations and configured lifecycle statuses', async () => {
  const { registry, adapter, calls, project } = fixture();
  const root = await mkdtemp(join(tmpdir(), 'tracker-'));
  try {
    const groups = new ProjectGroups(join(root, 'groups.json'));
    const id = await groups.create('Platform', { provider: 'example', project });
    const handlers = new Map<string, (...args: any[]) => any>();
    registerTrackerHandlers((name, fn) => handlers.set(name, fn), registry, groups);
    const call = (name: string, ...args: any[]) => handlers.get(name)!(...args);
    assert.equal((await call('tracker-board', id)).project.id, project.id);
    assert.equal(groups.groups[0].github, undefined);
    assert.throws(() => call('tracker-create-project', 'example', {}, 'New'), /does not support/);
    assert.throws(() => call('tracker-add-issue', id, 'url'), /does not support/);
    await assert.rejects(call('tracker-configure', id, { progress: 'made-up' }), /Select a status/);
    await call('tracker-configure', id, { progress: 'qa' });
    const api = {
      trackerProviders: async () => registry.list(),
      trackerBoard: (id: string) => call('tracker-board', id),
      trackerStatus: (...args: any[]) => call('tracker-status', ...args),
    } as API;
    await changeTaskStatus(api, groups.groups[0], 'task', 'progress');
    await changeTaskStatus(api, groups.groups[0], 'task', 'done');
    assert.deepEqual(calls, [
      [project, 'task', 'qa'],
      [project, 'task', 'released'],
    ]);
    const restored = new ProjectGroups(join(root, 'groups.json'));
    await restored.load();
    assert.deepEqual(restored.groups, groups.groups);
    assert.throws(() => registry.get('missing'), /unavailable/);
    assert.throws(() => new TrackerRegistry([adapter, adapter], 'example'), /duplicate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('legacy GitHub connections migrate without losing IDs, repositories, or unrelated fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tracker-migration-'));
  const file = join(root, 'groups.json');
  try {
    const github = {
      id: 'gh',
      title: 'Roadmap',
      url: 'https://github.com/orgs/team/projects/1',
      owner: 'team',
      number: 1,
    };
    await writeFile(
      file,
      JSON.stringify([{ id: 'g', name: 'Legacy', repoIds: ['repo'], github, hostId: 'host' }]),
    );
    const groups = new ProjectGroups(file);
    await groups.load();
    assert.deepEqual(groups.groups[0].tracker, { provider: 'github', project: github });
    await groups.update('g', 'Renamed');
    assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].tracker.provider, 'github');
    assert.deepEqual(groups.groups[0].repoIds, ['repo']);
    assert.equal(groups.groups[0].hostId, 'host');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
