import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exec } from '../electron/core';
import { WorktreeCreation } from '../electron/operations/worktree';
test('a lost worktree response recovers the same registered checkout without a second branch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worktree-recovery-'));
  try {
    const repo = join(root, 'repo'),
      project = join(root, 'project');
    await mkdir(repo);
    await mkdir(project);
    const git = async (cwd: string, args: string[]) =>
      (
        await exec('git', ['-C', cwd, ...args], {
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        })
      ).stdout;
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'Fixture']);
    await git(repo, ['config', 'user.email', 'fixture@example.test']);
    await writeFile(join(repo, 'file'), 'test');
    await git(repo, ['add', '.']);
    await git(repo, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Initial']);
    let creations = 0,
      lose = true;
    const effect = async (cwd: string, args: string[]) => {
      const result = await git(cwd, args);
      if (args[0] === 'worktree' && args[1] === 'add') {
        creations++;
        if (lose) throw Error('lost response');
      }
      return result;
    };
    const id = '11111111-1111-4111-8111-111111111111';
    const service = () => new WorktreeCreation(join(root, 'operations'), effect);
    await assert.rejects(service().run(repo, 'task/test', project, id), /lost response/);
    lose = false;
    const path = await service().run(repo, 'task/test', project, id);
    assert.equal((await git(path, ['branch', '--show-current'])).trim(), 'task/test');
    assert.equal(await service().run(repo, 'task/test', project, id), path);
    assert.equal(creations, 1);
    await assert.rejects(service().run(repo, 'other', project, id), /another project or branch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
