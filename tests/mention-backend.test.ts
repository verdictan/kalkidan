import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopFixture } from './helpers/desktop-fixture';
import { mentionToken } from '../src/domain/mentions';

test('mention files are listed only for project folders, on this computer or the SSH host', async () => {
  const f = await desktopFixture();
  assert.deepEqual(await f.invoke('mention-files', '/repo/src'), {
    files: ['a.ts'],
    truncated: false,
  });
  assert.ok(f.calls.some((c) => c[0] === 'mentionFiles' && c[1] === '/repo/src'));
  await f.invoke('mention-files', '/remote', 'host');
  assert.ok(f.calls.some((c) => c[0] === 'remote' && c[1] === 'host' && c[2] === 'mention-files'));
  for (const args of [['/outside'], ['/repo', 'host'], [42], ['/remote', 7]])
    await assert.rejects(f.invoke('mention-files', ...args), /Add this folder to a project/);
  f.state.remoteError = 'Unsupported remote operation';
  await assert.rejects(f.invoke('mention-files', '/remote', 'host'), /Update the Kalkidan helper/);
});

test('a local chat gets mention context from the folder, the docs and project chats', async () => {
  const f = await desktopFixture();
  const text = [
    mentionToken({ kind: 'file', id: 'src/a.ts', label: 'a.ts' }),
    mentionToken({ kind: 'doc', id: 'page', label: 'Page' }),
    mentionToken({ kind: 'chat', id: 'claude:c', label: 'Claude' }),
    mentionToken({ kind: 'chat', id: 'codex:missing', label: 'Gone' }),
    mentionToken({ kind: 'chat', id: 'bad:c', label: 'Bad' }),
    mentionToken({ kind: 'memory', id: 'm', label: 'Memory' }),
  ].join(' ');
  await f.invoke('chat-create', 'r', 'codex', text, true);
  const start = f.calls.find((c) => c[0] === 'chatStart');
  const prompt: string = start![2];
  assert.ok(prompt.indexOf('Mentioned items') < prompt.lastIndexOf('User request:'));
  assert.match(prompt, /"content":"\/repo:src\/a.ts"/);
  assert.match(prompt, /"label":"Claude","title":"Claude","agent":"claude","lastMessages"/);
  assert.match(prompt, /"label":"Gone","unavailable"/);
  assert.match(prompt, /"label":"Bad","unavailable"/);
  assert.match(prompt, /"label":"Memory","unavailable"/);
  assert.ok(f.calls.some((c) => c[0] === 'readDoc' && c[1] === 'g' && c[2] === 'page'));
});

test('a remote chat reads mentions on its SSH host and only from the project folders', async () => {
  const f = await desktopFixture();
  const text = [
    mentionToken({ kind: 'file', id: 'b.ts', label: 'b.ts' }),
    mentionToken({ kind: 'doc', id: 'page', label: 'Page' }),
    mentionToken({ kind: 'memory', id: 'm', label: 'Memory' }),
    mentionToken({ kind: 'chat', id: 'codex:host::s', label: 'Remote chat' }),
    mentionToken({ kind: 'chat', id: 'codex:host::other', label: 'Other' }),
  ].join(' ');
  await f.invoke('remote-call', 'host', 'chatCreate', ['/remote', 'codex', text, true]);
  const remote = (method: string) =>
    f.calls.filter((c) => c[0] === 'remote' && c[1] === 'host' && c[2] === method);
  assert.deepEqual(remote('mention-file-read')[0][3], ['/remote', 'b.ts']);
  assert.ok(remote('project-docs').some((c) => c[3][2] === 'read'));
  assert.ok(remote('project-memory').some((c) => c[3][2] === 'entries'));
  assert.deepEqual(remote('transcript')[0][3], ['codex', 's']);
  const create = remote('chatCreate').at(-1)!;
  const prompt: string = create[3][2];
  assert.match(prompt, /"label":"Remote chat","title":"Session","agent":"codex"/);
  assert.match(prompt, /"label":"Other","unavailable"/);
  assert.ok(prompt.endsWith(`User request:\n${text}`));
});
