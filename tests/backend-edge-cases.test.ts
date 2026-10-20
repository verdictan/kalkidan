import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { applyChatEvent, normalizeChatFailure } from '../electron/chat';
import { parseWorktrees } from '../electron/core';
import { appMenuTemplate } from '../electron/app-menu';

test('chat event fallbacks preserve session identity and report failures without terminal escape sequences', () => {
  const run: any = { agent: 'codex', messages: [], activity: '', sessionId: 'one' };
  normalizeChatFailure(run, '\u001b[31mstderr\u001b[0m');
  assert.equal(run.error, 'stderr');
  applyChatEvent(run, { item: { type: 'command_execution', status: 'completed' } });
  assert.equal(run.activity, 'Command completed');
  applyChatEvent(run, { item: { type: 'command_execution' } });
  assert.equal(run.activity, 'Running: ');
  applyChatEvent(run, { item: { type: 'file_change' } });
  assert.equal(run.activity, 'Updating project files');
  applyChatEvent(run, { type: 'turn.failed' });
  assert.match(run.error, /could not complete/);
  applyChatEvent(run, { type: 'error', error: { message: 'specific' } });
  assert.equal(run.error, 'specific');
  applyChatEvent(run, { item: { type: 'agent_message', text: '' } });
  assert.equal(run.messages.length, 0);
  run.agent = 'claude';
  applyChatEvent(run, { type: 'result', is_error: true });
  assert.match(run.error, /Claude/);
  applyChatEvent(run, { type: 'stream_event', event: { type: 'message_start' } });
  applyChatEvent(run, {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'part' } },
  });
  assert.equal(run.messages[0].text, 'part');
  run.activity = '';
  applyChatEvent(run, {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'next' } },
  });
  assert.equal(run.messages[1].id, 'stream');
  assert.deepEqual(parseWorktrees('HEAD deadbeef\n\n'), []);
  const links: string[] = [];
  const template = appMenuTemplate({
    mac: false,
    packaged: false,
    appName: 'Test',
    command: () => () => {},
    openExternal: (url) => links.push(url),
  });
  const help = template.find((item) => item.role === 'help')!;
  for (const item of help.submenu as any[]) item.click?.();
  assert.equal(links.length, 2);
});

test('untracked previews enforce the total budget, path containment and error recovery', async () => {
  let names = [
    'outside',
    'missing',
    'directory',
    ...Array.from({ length: 6 }, (_, i) => 'large' + i),
  ];
  const { repositoryDiff } = backendLoader({
    [resolve('electron/core.ts')]: {
      exec: async (_cmd: string, args: string[]) => ({
        stdout: args.includes('ls-files') ? names.join('\0') : '',
      }),
    },
    'node:fs/promises': {
      realpath: async (path: string) => (path.endsWith('outside') ? '/outside' : path),
      lstat: async (path: string) => {
        if (path.endsWith('missing')) throw Error('missing');
        return {
          isFile: () => !path.endsWith('directory'),
          isSymbolicLink: () => false,
          size: 100000,
        };
      },
      open: async () => ({
        read: async (buffer: Buffer) => {
          buffer.fill('a');
          return { bytesRead: buffer.length };
        },
        close: async () => {},
      }),
    },
  })(resolve('electron/conversation-tools.ts'));
  const result = await repositoryDiff('/repo');
  assert.match(result.newFiles[0].reason, /outside/);
  assert.match(result.newFiles[1].reason, /could not be read/);
  assert.match(result.newFiles.at(-1).reason, /limit/);
  names = [];
  assert.deepEqual((await repositoryDiff('/repo')).newFiles, []);
});

test('GitHub pull request failures distinguish missing CLI, missing URL and rejected API requests', async () => {
  let mode = 'missing';
  const { gitPullRequest, defaultBranch } = backendLoader({
    [resolve('electron/core.ts')]: {
      exec: async () => {
        if (mode === 'missing') throw { code: 'ENOENT' };
        if (mode === 'api') throw { stderr: 'denied' };
        return { stdout: 'no URL' };
      },
      parseWorktrees: () => [],
    },
  })(resolve('electron/git-working.ts'));
  const run = async (_cwd: string, args: string[]) =>
    args.includes('status')
      ? '# branch.head feature\n'
      : args.includes('symbolic-ref')
        ? 'unexpected'
        : 'main';
  await defaultBranch('/repo', run);
  for (mode of ['missing', 'api', 'no-url'])
    await assert.rejects(
      gitPullRequest('/repo', 'Title', 'Body', async () => ({ path: '/gh', env: {} }), run),
      mode === 'missing' ? /Install GitHub/ : mode === 'api' ? /denied/ : /pull request link/,
    );
});
