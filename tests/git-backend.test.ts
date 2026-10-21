import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { launchCommand, parseWorktrees } from '../electron/core';

test('shell commands quote folders and worktree records preserve spaces and detached heads', () => {
  assert.equal(launchCommand("/a' b", 'terminal'), "cd -- '/a'\\'' b'");
  // No terminal command can start a local agent CLI. Agents run only as managed agents.
  for (const agent of ['codex', 'claude', 'other'])
    assert.throws(() => launchCommand('/repo', agent as any), /inside Kalkidan/);
  assert.deepEqual(
    parseWorktrees(
      'worktree /main repo\nbranch refs/heads/main\n\nworktree /linked\nHEAD abc\n\nHEAD abc\n',
    ),
    [
      { path: '/main repo', branch: 'main' },
      { path: '/linked', branch: 'detached' },
    ],
  );
});

function fixture() {
  const calls: any[] = [];
  const state = {
    status: '? file',
    top: '/tree',
    trees: 'worktree /repo\nbranch refs/heads/main\n\nworktree /tree\nbranch refs/heads/feature\n',
    missingMain: false,
    error: null as any,
    branch: 'feature',
    upstream: false,
    head: 'origin/main',
    refsFail: false,
    countFail: false,
  };
  const run = async (_cwd: string, args: string[]) => {
    calls.push(args);
    if (state.error) throw state.error;
    if (args[0] === 'status')
      return args.includes('--branch')
        ? '# branch.head ' +
            state.branch +
            '\0' +
            (state.upstream ? '# branch.upstream origin/feature\0# branch.ab +2 -0\0' : '') +
            state.status
        : state.status;
    if (args[0] === 'symbolic-ref') {
      if (!state.head) throw Error('no HEAD');
      return state.head;
    }
    if (args[0] === 'show-ref' && state.refsFail) throw Error('missing ref');
    if (args[0] === 'rev-list') {
      if (state.countFail || args.at(-1)!.startsWith('origin/')) throw Error('no remote');
      return '3';
    }
    if (args[0] === 'rev-parse') return args.includes('--show-toplevel') ? state.top : 'abcdef1';
    if (args[0] === 'worktree' && args[1] === 'list') return state.trees;
    return '';
  };
  const mod = backendLoader({
    'node:fs/promises': {
      realpath: async (p: string) => {
        if (state.missingMain && p === '/repo') throw Error('not mounted');
        return p;
      },
    },
    [resolve('electron/core.ts')]: {
      parseWorktrees,
      exec: async (_exe: string, args: string[]) => ({ stdout: await run(args[1], args.slice(2)) }),
    },
  })(resolve('electron/git-working.ts'));
  return { ...mod, state, calls, run };
}

test('Git commands handle branch fallback, changed files and commit sequencing without running Git', async () => {
  const f = fixture();
  assert.equal((await f.workingStatus('/tree')).ahead, 3);
  f.state.upstream = true;
  assert.equal((await f.workingStatus('/tree')).ahead, 2);
  f.state.head = '';
  assert.equal(await f.defaultBranch('/tree'), 'main');
  f.state.refsFail = true;
  assert.equal(await f.defaultBranch('/tree'), 'main');
  f.state.upstream = false;
  f.state.countFail = true;
  assert.equal((await f.workingStatus('/tree')).ahead, 0);
  f.state.refsFail = false;
  f.state.head = 'unexpected';
  assert.equal(await f.defaultBranch('/tree'), 'main');
  assert.deepEqual(await f.gitCommit('/tree', '  Test  '), { commit: 'abcdef1' });
  assert.deepEqual(f.calls.slice(-4), [
    ['status', '--porcelain'],
    ['add', '-A'],
    ['commit', '-m', 'Test'],
    ['rev-parse', '--short', 'HEAD'],
  ]);
  for (const value of ['', 'x'.repeat(20001), null])
    await assert.rejects(f.gitCommit('/tree', value));
  f.state.status = '';
  await assert.rejects(f.gitCommit('/tree', 'Test'), /no changes/);
  f.state.error = { stderr: 'Command failed: secret\npermission denied\n' };
  await assert.rejects(f.workingStatus('/tree'), /^Error: permission denied$/);
  f.state.error = {};
  await assert.rejects(f.workingStatus('/tree'), /Git could not complete/);
  assert.equal(f.parseWorkingStatus('# branch.ab invalid\0').ahead, 0);
});

test('worktree removal protects the main checkout and requires explicit force for dirty folders', async () => {
  const f = fixture();
  await assert.rejects(f.removeWorktree('/tree'), /uncommitted/);
  await f.removeWorktree('/tree', true);
  assert.deepEqual(f.calls.at(-1), ['worktree', 'remove', '--force', '--', '/tree']);
  f.state.status = '';
  f.state.missingMain = true;
  await f.removeWorktree('/tree');
  assert.deepEqual(f.calls.at(-1), ['worktree', 'remove', '--', '/tree']);
  await assert.rejects(f.removeWorktree('/tree/sub'), /top folder/);
  f.state.missingMain = false;
  f.state.top = '/repo';
  await assert.rejects(f.removeWorktree('/repo'), /main checkout/);
  f.state.trees = '';
  await assert.rejects(f.removeWorktree('/tree'), /main checkout/);
});
