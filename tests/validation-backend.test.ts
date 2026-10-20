import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { parsePasswordCSV } from '../electron/browser-import';
import { executableCandidates, commandShell } from '../electron/platform';

test('repository API failures do not return incomplete or invalid lists', async () => {
  let data: unknown = [];
  let error: unknown;
  const { listRepositories, cloneRepository } = backendLoader({
    [resolve('electron/core.ts')]: {
      exec: async () => {
        if (error) throw error;
        return { stdout: JSON.stringify(data) };
      },
    },
    [resolve('electron/github-projects.ts')]: { githubExecutable: async () => '/gh' },
  })(resolve('electron/repositories.ts'));
  error = { code: 'ENOENT' };
  await assert.rejects(listRepositories(), /Install GitHub CLI/);
  error = undefined;
  for (data of [
    {},
    [null],
    [[{ full_name: 2, private: false }]],
    [[{ full_name: 'owner/repo', private: 'false' }]],
  ])
    await assert.rejects(listRepositories(), /invalid|incomplete/);
  await assert.rejects(cloneRepository('owner/repo', 'relative'), /local destination/);
});

test('saved group validation rejects corrupt records and mutations of unknown groups', async () => {
  let content = '[]';
  const { ProjectGroups } = backendLoader({
    'node:fs/promises': { readFile: async () => content, mkdir: async () => {} },
    [resolve('electron/storage/directory-lock.ts')]: {
      withDirectoryLock: async (_path: string, action: (guard: () => void) => Promise<unknown>) =>
        action(() => {}),
    },
    [resolve('electron/storage/atomic-json.ts')]: { writeJSON: async () => {} },
  })(resolve('electron/project-groups.ts'));
  const groups = new ProjectGroups('/fixture');
  for (const value of [
    {},
    [{ id: 'g', name: 'G', repoIds: [1] }],
    [{ id: 'g', name: 'G', repoIds: [], tracker: { provider: 'github' } }],
  ]) {
    content = JSON.stringify(value);
    await assert.rejects(groups.load(), /Invalid/);
  }
  content = '[{"id":"g","name":"G","repoIds":[]}]';
  await groups.load();
  for (const name of ['', 'x'.repeat(151), null])
    await assert.rejects(groups.create(name, null), /Project name/);
  await assert.rejects(groups.update('missing', 'New'), /not found/);
  await assert.rejects(groups.remove('missing'), /not found/);
  await assert.rejects(groups.configure('g', { done: 'done' }), /tracker/);
});

test('empty imports and missing executable paths have explicit safe outcomes', () => {
  assert.throws(() => parsePasswordCSV(''), /columns/);
  assert.deepEqual(parsePasswordCSV('url,username,password\nhttps://example.test,,secret\n'), [
    { origin: 'https://example.test', username: '', password: 'secret' },
  ]);
  assert.deepEqual(executableCandidates('codex', {}, 'linux'), []);
  const { commandShell: shell } = backendLoader(
    {},
    { process: { platform: 'linux', env: {} } },
  )(resolve('electron/platform.ts'));
  assert.deepEqual(shell('echo'), { file: '/bin/sh', args: ['-lc', 'echo'] });
  assert.equal(commandShell('echo', 'win32').file, 'powershell.exe');
});

test('GitHub board validation handles deleted projects, missing statuses and invalid pagination', async () => {
  let data: any = {};
  const { GitHubProjects } = backendLoader()(resolve('electron/github-projects.ts'));
  const github = new GitHubProjects(async () => data);
  await assert.rejects(github.list({ kind: 'user', login: 'test' }), /not accessible/);
  await assert.rejects(github.board({ id: 'P' }), /no longer accessible/);
  data = {
    node: {
      fields: { nodes: [] },
      items: {
        nodes: [{ id: 'draft', content: { title: 'Draft' }, fieldValues: { nodes: [] } }],
        pageInfo: { hasNextPage: false },
      },
    },
  };
  const board = await github.board({ id: 'P' });
  assert.equal(board.statusField, undefined);
  assert.equal(board.items[0].body, '');
  data.node.items.pageInfo = { hasNextPage: true };
  await assert.rejects(github.board({ id: 'P' }, true), /pagination/);
  data = { user: { projectsV2: { nodes: [], pageInfo: { hasNextPage: true } } } };
  await assert.rejects(github.list({ kind: 'user', login: 'test' }), /pagination/);
});
