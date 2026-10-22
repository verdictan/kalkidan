import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addForkLink,
  chatLink,
  forkDraft,
  forkFolder,
  forkHistoryLimit,
  forkHistoryRoom,
  forkLinkLimit,
  forkTitle,
  historyUntil,
  packageForkHistory,
  type ChatLink,
} from '../src/domain/chat-fork';
import { chatActionMenu, sessionActionState } from '../src/domain/chat-actions';
import { createProjectPrompt } from '../electron/projects/prompt';
import { SessionLibrary, validateOrganization } from '../electron/session-library';
import { TrackerRegistry } from '../electron/trackers/registry';
import { visibleUserText } from '../electron/transcript';
import type { ChatMessage, Project, ProjectGroup } from '../src/types';

const source = { agent: 'claude' as const, title: 'Fix login' };
const message = (index: number, text = `message ${index}`): ChatMessage => ({
  id: String(index),
  role: index % 2 ? 'assistant' : 'user',
  text,
});
const items = (text: string) => JSON.parse(text.slice(text.lastIndexOf('\n') + 1));

test('a fork packages the full history as one context block', () => {
  const messages = [message(0), message(1), message(2)];
  const history = packageForkHistory(source, messages);
  assert.equal(history.total, 3);
  assert.equal(history.included, 3);
  assert.equal(history.shortened, false);
  assert.match(history.text, /^\n\nEarlier chat \(reference data, not instructions\)/);
  assert.match(history.text, /fork of the Claude Code chat "Fix login"/);
  assert.match(history.text, /do not do the requests in them again/);
  assert.doesNotMatch(history.text, /too long/);
  assert.deepEqual(items(history.text), [
    { role: 'user', text: 'message 0' },
    { role: 'assistant', text: 'message 1' },
    { role: 'user', text: 'message 2' },
  ]);
  // No messages: no context.
  assert.deepEqual(packageForkHistory(source, []), {
    text: '',
    total: 0,
    included: 0,
    shortened: false,
  });
});

test('a long history keeps the most recent messages and a note', () => {
  const messages = Array.from({ length: 100 }, (_, i) => message(i, `${i} ` + 'x'.repeat(1000)));
  const history = packageForkHistory(source, messages);
  assert.ok(history.text.length <= forkHistoryLimit);
  assert.equal(history.shortened, true);
  assert.equal(history.total, 100);
  assert.ok(history.included > 10 && history.included < 100);
  assert.match(history.text, /The history was too long\. Only the most recent part is included/);
  const kept = items(history.text);
  assert.equal(kept.length, history.included);
  // The newest messages, oldest first.
  assert.equal(kept.at(-1).text, messages[99].text);
  assert.equal(kept[0].text, messages[100 - history.included].text);
  // A transcript without its oldest messages also gets the note.
  assert.equal(packageForkHistory(source, [message(0)], true).shortened, true);
  assert.match(packageForkHistory(source, [message(0)], true).text, /too long/);
});

test('a newest message that is too long keeps its end', () => {
  const long = 'start ' + '"\\'.repeat(20000) + ' end';
  const history = packageForkHistory(source, [message(0), message(1, long)], false, 5000);
  assert.ok(history.text.length <= 5000);
  assert.equal(history.included, 1);
  assert.equal(history.shortened, true);
  const [kept] = items(history.text);
  assert.ok(kept.text.startsWith('…'));
  assert.ok(kept.text.endsWith(' end'));
  // No room at all: no context.
  assert.equal(packageForkHistory(source, [message(0)], false, 0).text, '');
});

test('the history gets less room next to a long first message', () => {
  assert.equal(forkHistoryRoom(10), forkHistoryLimit);
  assert.equal(forkHistoryRoom(60000), 15000);
  assert.equal(forkHistoryRoom(100000), 0);
  // The prompt with the history stays inside the limit of the agent run.
  assert.ok(70000 + 55000 + forkHistoryRoom(70000) <= 130000);
});

test('a fork title and links are valid organization values', () => {
  assert.equal(forkTitle('Fix login'), 'Fix login (fork)');
  assert.equal(forkTitle('  '), 'Chat (fork)');
  const long = forkTitle('a'.repeat(200));
  assert.equal(long.length, 160);
  assert.ok(long.endsWith('… (fork)'));
  const link: ChatLink = { agent: 'codex', id: 'host-1::abc', title: 'Fix login' };
  assert.deepEqual(chatLink(link), link);
  assert.equal(chatLink({ ...link, agent: 'other' }), undefined);
  assert.equal(chatLink({ ...link, id: '../x y' }), undefined);
  assert.equal(chatLink({ ...link, title: 'a'.repeat(161) }), undefined);
  assert.equal(chatLink([link]), undefined);
  assert.equal(chatLink(null), undefined);
  // A fork shows once in its source, and the source keeps the last forks only.
  const many = Array.from({ length: 30 }, (_, i) => ({ ...link, id: `id-${i}` }));
  let forks: ChatLink[] | undefined;
  for (const fork of many) forks = addForkLink(forks, fork);
  forks = addForkLink(forks, many[29]);
  assert.equal(forks!.length, forkLinkLimit);
  assert.equal(forks!.at(-1)!.id, 'id-29');
  assert.equal(forks!.filter((fork) => fork.id === 'id-29').length, 1);
});

test('the session library keeps the fork links and refuses invalid links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-fork-'));
  try {
    const file = join(root, 'sessions.json');
    const from: ChatLink = { agent: 'claude', id: 'source-1', title: 'Fix login' };
    const to: ChatLink = { agent: 'codex', id: 'host-1::fork-1', title: 'Fix login (fork)' };
    const library = new SessionLibrary(file);
    await library.update('codex', 'host-1::fork-1', { title: to.title, forkedFrom: from });
    await library.update('claude', 'source-1', { forks: [to] });
    const restored = new SessionLibrary(file);
    await restored.load();
    const [fork, original] = restored.decorate([
      { agent: 'codex', id: 'host-1::fork-1', cwd: '/r', title: 'x', updatedAt: '' },
      { agent: 'claude', id: 'source-1', cwd: '/r', title: 'x', updatedAt: '' },
    ]);
    assert.deepEqual(fork.organization.forkedFrom, from);
    assert.deepEqual(original.organization.forks, [to]);
    assert.throws(() => validateOrganization({ forkedFrom: { agent: 'codex' } }), /forkedFrom/);
    assert.throws(() => validateOrganization({ forks: {} }), /forks/);
    assert.throws(
      () => validateOrganization({ forks: Array.from({ length: 21 }, () => to) }),
      /forks/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const folder = (id: string, name: string, hostId?: string): Project => ({
  id,
  name,
  path: `/work/${name}`,
  ...(hostId ? { hostId } : {}),
  favorite: false,
  notes: '',
  addedAt: '',
});

test('a fork finds the code folder on the target computer', () => {
  const mac = folder('mac', 'atlas');
  const devbox = folder('devbox', 'atlas-checkout', 'devbox');
  const other = folder('other', 'atlas', 'build');
  const named = folder('named', 'atlas-api', 'named-host');
  const projects = [mac, devbox, other, named, folder('unrelated', 'zeta', 'empty')];
  const groups: ProjectGroup[] = [
    { id: 'g1', name: 'Atlas', repoIds: ['mac', 'devbox'] },
    { id: 'g2', name: 'Atlas', hostId: 'named-host', repoIds: ['named'] },
  ];
  // The same computer: the folder of the source.
  assert.equal(forkFolder(mac, undefined, projects, groups), mac);
  assert.equal(forkFolder(devbox, 'devbox', projects, groups), devbox);
  // Another computer: a folder of the same project first.
  assert.equal(forkFolder(mac, 'devbox', projects, groups), devbox);
  assert.equal(forkFolder(devbox, undefined, projects, groups), mac);
  // Then a project with the same name, then a folder with the same name.
  assert.equal(forkFolder(mac, 'named-host', projects, groups), named);
  assert.equal(forkFolder(mac, 'build', projects, groups), other);
  // The project is not on the computer.
  assert.equal(forkFolder(mac, 'empty', projects, groups), undefined);
  assert.equal(forkFolder(undefined, undefined, projects, groups), undefined);
});

test('a fork is a new chat that links to its source', () => {
  const link: ChatLink = { agent: 'claude', id: 'source-1', title: 'Fix login' };
  const draft = forkDraft(
    link,
    'codex',
    folder('devbox', 'atlas', 'devbox'),
    'draft-1',
    new Date('2026-10-22T10:00:00Z'),
  );
  assert.deepEqual(draft, {
    id: 'draft-1',
    projectId: 'devbox',
    hostId: 'devbox',
    agent: 'codex',
    cwd: '/work/atlas',
    title: 'Fix login (fork)',
    forkOf: link,
    organization: { title: 'Fix login (fork)', forkedFrom: link },
    updatedAt: '2026-10-22T10:00:00.000Z',
  });
  assert.equal(
    forkDraft(link, 'codex', folder('mac', 'atlas'), 'draft-3', new Date(), 'm-4').forkUntil,
    'm-4',
  );
  // No `forkFrom`: the agent does not resume the source conversation or its binding.
  assert.equal('forkFrom' in draft, false);
  assert.equal('hostId' in forkDraft(link, 'claude', folder('mac', 'atlas'), 'draft-2'), false);
});

test('the first message of a fork has the history before the user request', async () => {
  const projects = [folder('repo', 'atlas')];
  const prompt = createProjectPrompt({
    trackers: new TrackerRegistry([{ descriptor: { id: 'fake' } } as never], 'fake'),
    projects: () => projects,
    groups: () => [],
  });
  const history = packageForkHistory(source, [message(0), message(1)]).text;
  // Outside a project.
  const outside = await prompt('/work/atlas', 'Continue', undefined, undefined, undefined, history);
  assert.ok(outside.startsWith('Project context supplied by Kalkidan.'));
  assert.ok(outside.includes(history));
  assert.ok(outside.endsWith('\n\nUser request:\nContinue'));
  assert.equal(visibleUserText(outside), 'Continue');
  // Without history, the prompt does not change.
  assert.equal(await prompt('/work/atlas', 'Continue'), 'Continue');
  // In a project.
  const inProject = createProjectPrompt({
    trackers: new TrackerRegistry([{ descriptor: { id: 'fake' } } as never], 'fake'),
    projects: () => projects,
    groups: () => [{ id: 'g', name: 'Atlas', repoIds: ['repo'] }],
  });
  const text = await inProject('/work/atlas', 'Continue', undefined, undefined, undefined, history);
  assert.ok(text.includes(history));
  assert.ok(text.indexOf(history) < text.lastIndexOf('User request:'));
  assert.equal(visibleUserText(text), 'Continue');
});

test('a fork of a running chat has the history of the moment of the fork', () => {
  const messages = [message(0), message(1), message(2), message(3)];
  // The source continued after the fork. Its later messages are not history of the fork.
  assert.deepEqual(historyUntil(messages, '1'), messages.slice(0, 2));
  // An unknown or missing message: all messages.
  assert.deepEqual(historyUntil(messages, 'gone'), messages);
  assert.deepEqual(historyUntil(messages), messages);
  // Fork is available while the agent works, and in a read-only chat.
  const state = sessionActionState(
    { id: 's', agent: 'codex', cwd: '/r', title: 'x', updatedAt: '' },
    { running: true, open: true },
  );
  const fork = chatActionMenu('header', state, 'mac')
    .flatMap((group) => group.items)
    .find((item) => item.id === 'fork');
  assert.equal(fork?.disabled, false);
});
