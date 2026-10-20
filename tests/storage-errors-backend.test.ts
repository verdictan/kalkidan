import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { backendLoader } from './helpers/backend-loader';
import { ProjectDocs } from '../electron/storage/project-docs';
import { ProjectLocationCache } from '../electron/storage/project-location';
import { DocsRetrievalIndex } from '../electron/storage/docs-retrieval';
import { ProjectGroups } from '../electron/project-groups';
import { registerTrackerHandlers } from '../electron/trackers/ipc';

test('directory listing maps access errors and propagates unexpected filesystem failures', async () => {
  let code = 'EACCES';
  const { listDirectory } = backendLoader({
    'node:fs/promises': {
      realpath: async () => {
        throw Object.assign(Error('disk failed'), { code });
      },
    },
  })(resolve('electron/storage/directory-list.ts'));
  for (code of ['EACCES', 'EPERM'])
    await assert.rejects(listDirectory('/repo'), /access permissions/);
  code = 'EIO';
  await assert.rejects(listDirectory('/repo'), /disk failed/);
});

test('failed FTS updates roll back the transaction and preserve existing indexed knowledge', () => {
  const index = new DocsRetrievalIndex();
  try {
    index.update(
      {
        id: 'page',
        title: 'Title',
        parentId: null,
        revision: 'one',
        markdown: 'Previous knowledge',
      },
      'one',
    );
    assert.throws(() =>
      index.update(
        { id: 'page', title: 'Title', parentId: null, revision: 'two', markdown: null } as any,
        'two',
      ),
    );
    assert.equal(index.search('Previous')[0].revision, 'one');
    assert.equal(index.stamps.get('page'), 'one');
  } finally {
    index.close();
  }
});

test('project locations reject replacement symlinks and trash skips malformed pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backend-errors-'));
  try {
    const cache = new ProjectLocationCache(root),
      folder = await cache.get('project');
    await rm(join(folder, '.kalkidan-project'));
    await symlink('/missing', join(folder, '.kalkidan-project'));
    await assert.rejects(cache.get('project'), /symbolic link/);
    const docs = new ProjectDocs(join(root, 'docs'), () => true);
    await docs.create('group', 'Title', null);
    await mkdir(join(root, 'docs', 'group', '.trash'));
    await writeFile(join(root, 'docs', 'group', '.trash', 'page-123.md'), 'invalid');
    await writeFile(join(root, 'docs', 'group', '.trash', 'ignored.txt'), 'ignored');
    assert.deepEqual(await docs.trash('group'), []);
    await rm(join(root, 'docs', 'group', '.trash'), { recursive: true });
    await writeFile(join(root, 'docs', 'group', '.trash'), 'not a folder');
    await assert.rejects(docs.trash('group'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('project group mutations persist roots and tracker changes, reject missing groups and recover after failed edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'groups-backend-'));
  try {
    const groups = new ProjectGroups(join(root, 'groups.json'));
    await groups.load();
    const id = await groups.create(
      'Name',
      null,
      'host',
      '/project',
      '00000000-0000-4000-8000-000000000001',
    );
    await groups.setRoot(id, '/updated');
    assert.equal(groups.groups[0].rootPath, '/updated');
    const project = {
      id: 'P',
      title: 'Title',
      url: 'https://github.com/orgs/test/projects/1',
      owner: 'test',
      number: 1,
    };
    await groups.link(id, project);
    await assert.rejects(groups.link('missing', project), /not found/);
    await assert.rejects(groups.link(id, undefined), /require a GitHub/);
    await groups.connect(id, { provider: 'github', project });
    assert.equal(groups.groups[0].github?.id, 'P');
    await groups.connect(id, { provider: 'other', project });
    assert.equal(groups.groups[0].github, undefined);
    await assert.rejects(groups.connect('missing', { provider: 'github', project }), /not found/);
    await assert.rejects(groups.connect(id, {} as any), /Invalid tracker/);
    await assert.rejects(groups.setRoot('missing', '/path'), /not found/);
    await assert.rejects(groups.create('Name', undefined as any), /Choose a tracker/);
    await groups.configure(id, { done: 'done' });
    assert.equal(groups.groups[0].tracker?.statusMapping?.done, 'done');
    await groups.update(id, 'Recovered');
    assert.equal(groups.groups[0].name, 'Recovered');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tracker link and draft handlers resolve projects before mutation and require supported capabilities', async () => {
  const handlers = new Map<string, Function>(),
    calls: any[] = [];
  const provider = {
    resolve: async (reference: string) => ({ id: reference }),
    createItem: async (...args: any[]) => calls.push(args),
    descriptor: { id: 'test' },
  };
  const groups: any = {
    groups: [{ id: 'g' }],
    connect: async (...args: any[]) => calls.push(args),
  };
  registerTrackerHandlers(
    (name, fn) => handlers.set(name, fn),
    {
      get: () => provider,
      linked: () => ({ provider, project: { id: 'P' } }),
      require: () => provider,
    } as any,
    groups,
  );
  await assert.rejects(handlers.get('tracker-link')!('missing', 'test', 'url'), /not found/);
  await handlers.get('tracker-link')!('g', 'test', 'url');
  assert.deepEqual(calls[0], ['g', { provider: 'test', project: { id: 'url' } }]);
  await handlers.get('tracker-draft')!('g', 'Title', 'Body');
  assert.deepEqual(calls[1], [{ id: 'P' }, 'Title', 'Body']);
});

test('repository cloning retains filesystem errors and memory readers close skipped files', async () => {
  const error = Object.assign(Error('read-only disk'), { code: 'EROFS' });
  const repositories = backendLoader({
    'node:fs/promises': {
      mkdir: async () => {
        throw error;
      },
    },
  })(resolve('electron/repositories.ts'));
  await assert.rejects(
    repositories.cloneRepository(
      'owner/repo',
      '/new',
      async () => {},
      async () => '/gh',
    ),
    (e) => e === error,
  );
  const closed: string[] = [];
  const memory = backendLoader({
    'node:fs/promises': {
      mkdir: async () => {},
      lstat: async () => ({ isSymbolicLink: () => false }),
      readdir: async () =>
        ['directory.md', 'empty.md'].map((name) => ({ name, isFile: () => true })),
      open: async (path: string) => {
        if (path.endsWith('.json')) throw Object.assign(Error('missing'), { code: 'ENOENT' });
        return {
          stat: async () => ({ isFile: () => !path.endsWith('directory.md'), size: 0 }),
          close: async () => {
            closed.push(path);
          },
        };
      },
    },
  })(resolve('electron/storage/project-memory.ts'));
  assert.deepEqual(await memory.readProjectMemory('/repo'), { pages: [], limited: true });
  assert.equal(closed.length, 2);
});

test('project location cache rebuilds when marker identity changes and propagates disk errors', async () => {
  let generation = 1;
  let code = '';
  const api = backendLoader({
    'node:fs/promises': {
      mkdir: async () => {},
      readdir: async () => [],
      lstat: async () => ({ isSymbolicLink: () => false, ino: generation }),
      writeFile: async () => {
        if (code) throw Object.assign(Error('disk error'), { code });
      },
      realpath: async (path: string) => path,
    },
  })(resolve('electron/storage/project-location.ts'));
  const cache = new api.ProjectLocationCache('/base');
  await cache.get('one');
  generation++;
  assert.equal(await cache.get('one'), '/base/one');
  assert.equal(cache.metrics.preparations, 2);
  code = 'EIO';
  await assert.rejects(api.prepareProjectLocation('two', undefined, '/base'), /disk error/);
  for (const [id, path] of [
    ['bad/id', '/base'],
    ['ok', 'relative'],
  ])
    await assert.rejects(api.prepareProjectLocation(id, path, '/base'));
});
