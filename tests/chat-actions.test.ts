import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatAccelerator,
  chatActionAvailability,
  chatActionForCommand,
  chatActionForKey,
  chatActionGroups,
  chatActionMenu,
  chatActions,
  chatCommands,
  flatChatActions,
  isChatCommand,
  leafChatActions,
  parseChatActionState,
  reasons,
  sessionActionState,
  type ChatActionState,
  type ChatActionSurface,
} from '../src/domain/chat-actions';
import { menuCommands } from '../src/api/contracts';
import type { Session } from '../src/types';

const session: Session = { id: 's', agent: 'codex', cwd: '/repo', title: 'Chat', updatedAt: '' };
const ready: ChatActionState = sessionActionState(session, {
  usageHistory: true,
  repository: true,
  project: true,
});
const surfaces: ChatActionSurface[] = ['list', 'header', 'menu-bar', 'palette'];
const ids = (state: ChatActionState, surface: ChatActionSurface = 'list') =>
  chatActionMenu(surface, state, 'mac').map((group) => [
    group.group,
    group.items.map((item) => item.id),
  ]);

/** The IDs of one submenu of the chat menus. */
const submenuIds = (id: string, state: ChatActionState, surface: ChatActionSurface = 'list') =>
  chatActionMenu(surface, state, 'mac')
    .flatMap((group) => group.items)
    .find((item) => item.id === id)
    ?.children?.map((item) => item.id) || [];

test('the actions keep the fixed groups and order', () => {
  assert.deepEqual(chatActionGroups, ['open', 'organize', 'work', 'share', 'developer', 'archive']);
  // The menu bar and the palette show all actions in their groups.
  assert.deepEqual(ids({ ...ready, open: true }, 'menu-bar'), [
    ['open', ['open-beside', 'open-window']],
    ['organize', ['rename', 'pin', 'link-task', 'notes']],
    // "Fork chat…" is the one way to copy a chat. Duplicate shows nowhere.
    ['work', ['commit', 'create-pull-request', 'fork', 'show-folder']],
    ['share', ['share', 'copy-markdown', 'usage-history']],
    ['developer', ['developer']],
    ['archive', ['archive']],
  ]);
  // The list is in group order, so each group is one block.
  const order = chatActions.map((action) => chatActionGroups.indexOf(action.group));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  // The submenus keep their items in order.
  const children = (id: string) =>
    chatActions.find((action) => action.id === id)!.children!.map((child) => child.id);
  assert.deepEqual(children('duplicate'), ['duplicate-here', 'duplicate-branch']);
  assert.deepEqual(children('share'), ['export-markdown', 'export-html', 'save-to-docs']);
  assert.deepEqual(children('developer'), ['copy-id', 'copy-path', 'open-vscode', 'open-cursor']);
});

test('the chat menus show their items in two levels', () => {
  // Notes, side chat, export and usage history are in the menu bar and the palette only.
  assert.deepEqual(ids(ready), [
    ['organize', ['rename', 'pin', 'link-task']],
    ['work', ['fork', 'open-in']],
    ['archive', ['archive']],
  ]);
  assert.deepEqual(submenuIds('open-in', ready), [
    'show-folder',
    'open-vscode',
    'open-cursor',
    'open-window',
  ]);
  // The pull request is in the changes row of the chat, not in these menus. Commit and Mark task
  // done show only when they can run.
  const all = chatActionMenu('list', ready, 'mac').flatMap((group) => group.items);
  assert.ok(!all.some((item) => ['commit', 'create-pull-request'].includes(item.id)));
  assert.deepEqual(ids({ ...ready, noChanges: false, canMarkDone: true })[1], [
    'work',
    ['commit', 'mark-task-done', 'fork', 'open-in'],
  ]);
  // No submenu has a third level.
  for (const item of all)
    for (const child of item.children || []) assert.equal(child.children, undefined);
});

test('the chat row menu and the chat header menu show the same actions', () => {
  // A click on a row opens the chat, so the row menu has no Open.
  const list = ids(ready, 'list');
  const header = ids({ ...ready, open: true }, 'header');
  assert.deepEqual(list, header);
  assert.deepEqual(submenuIds('open-in', ready), submenuIds('open-in', { ...ready, open: true }));
  // The menu bar and the palette act on the open chat. They show the same actions.
  assert.deepEqual(
    ids({ ...ready, open: true }, 'palette'),
    ids({ ...ready, open: true }, 'menu-bar'),
  );
});

test('actions hide only when they cannot apply', () => {
  const linked = ids({ ...ready, linkedTask: true });
  assert.deepEqual(linked[0], ['organize', ['rename', 'pin', 'open-linked-task']]);
  // Without a board, there is no task to link.
  assert.deepEqual(ids({ ...ready, board: false })[0], ['organize', ['rename', 'pin']]);
  assert.ok(
    !chatActionMenu('menu-bar', { ...ready, open: true, board: false }, 'mac')
      .flatMap((group) => group.items)
      .some((item) => item.id === 'link-task'),
  );
  // Without managed agents there is no usage history. A chat on an SSH host has one.
  const allIds = (state: typeof ready) => ids({ ...state, open: true }, 'palette').flat(2);
  assert.ok(!allIds({ ...ready, usageHistory: false }).includes('usage-history'));
  assert.ok(allIds({ ...ready, remote: true }).includes('usage-history'));
  // With a pull request, View pull request #N replaces Create pull request.
  const withPullRequest = chatActionMenu(
    'menu-bar',
    { ...ready, open: true, pullRequest: true, pullRequestNumber: 12 },
    'mac',
  ).flatMap((group) => group.items);
  assert.ok(!withPullRequest.some((item) => item.id === 'create-pull-request'));
  assert.equal(
    withPullRequest.find((item) => item.id === 'open-pull-request')?.label,
    'View pull request #12',
  );
  // Every surface shows Archive. Pin and Archive change their labels with the state.
  for (const surface of surfaces) {
    const menu = chatActionMenu(surface, { ...ready, pinned: true, archived: true }, 'mac');
    const labels = menu.flatMap((group) => group.items.map((item) => item.label));
    assert.ok(labels.includes('Unpin'));
    assert.ok(labels.includes('Restore'));
  }
});

test('a blocked submenu item keeps its reason in the chat menus', () => {
  const draft = sessionActionState({ ...session, id: 'draft-1' }, { repository: true });
  const openIn = chatActionMenu('list', draft, 'mac')
    .flatMap((group) => group.items)
    .find((item) => item.id === 'open-in')!;
  assert.equal(
    openIn.children!.find((item) => item.id === 'open-window')!.reason,
    reasons.firstMessage,
  );
});

test('blocked actions are disabled with a reason', () => {
  const item = (state: ChatActionState, id: string) =>
    chatActionMenu('menu-bar', { ...state, open: true }, 'mac')
      .flatMap((group) => group.items)
      .find((entry) => entry.id === id)!;
  assert.deepEqual(
    [item(ready, 'commit').disabled, item(ready, 'commit').reason],
    [false, undefined],
  );
  assert.equal(item({ ...ready, noChanges: true }, 'commit').reason, reasons.noChanges);
  assert.equal(item({ ...ready, running: true }, 'commit').reason, reasons.running);
  assert.equal(item({ ...ready, repository: false }, 'commit').reason, reasons.noFolder);
  // A state that is not known does not block an action.
  const unknown = sessionActionState(session);
  assert.equal(item(unknown, 'commit').disabled, false);
  assert.equal(item(unknown, 'link-task').disabled, false);
  // A new chat cannot export or duplicate before its first message.
  const draft = sessionActionState({ ...session, id: 'draft-1' }, { repository: true });
  assert.equal(draft.saved, false);
  for (const id of ['fork', 'share', 'copy-markdown', 'open-window', 'developer'])
    assert.equal(item(draft, id).reason, reasons.firstMessage, id);
  assert.equal(item(ready, 'create-pull-request').disabled, false);
  assert.equal(
    item({ ...ready, noBranchWork: true }, 'create-pull-request').reason,
    reasons.noBranchWork,
  );
  assert.equal(item({ ...ready, running: true }, 'create-pull-request').reason, reasons.running);
  assert.equal(item({ ...ready, pullRequest: true }, 'open-pull-request').disabled, false);
  assert.equal(item({ ...ready, remote: true }, 'show-folder').reason, reasons.remote);
  assert.equal(item({ ...ready, project: false }, 'link-task').reason, reasons.noProject);
  assert.equal(item({ ...ready, running: true }, 'archive').reason, reasons.running);
});

test('a submenu item takes the reason of its submenu', () => {
  const running = { ...ready, running: true };
  assert.equal(chatActionAvailability('export-html', running), reasons.running);
  assert.equal(chatActionAvailability('export-html', ready), true);
  assert.equal(
    chatActionAvailability('save-to-docs', { ...ready, project: false }),
    reasons.noProject,
  );
  const leaves = leafChatActions(chatActionMenu('palette', { ...running, open: true }, 'mac'));
  const exportHtml = leaves.find((entry) => entry.id === 'export-html')!;
  assert.deepEqual([exportHtml.disabled, exportHtml.reason], [true, reasons.running]);
  assert.ok(!leaves.some((entry) => entry.children));
});

test('each command belongs to one action and the menu bar can send it', () => {
  const commands = flatChatActions().flatMap((action) => (action.command ? [action.command] : []));
  assert.deepEqual(commands, [...chatCommands]);
  assert.equal(new Set(commands).size, commands.length);
  for (const command of chatCommands) {
    assert.ok((menuCommands as readonly string[]).includes(command), command);
    assert.ok(isChatCommand(command));
    assert.equal(chatActionForCommand(command)?.command, command);
  }
  assert.equal(isChatCommand('session-new'), false);
  // Submenus have no command. Their items have one.
  for (const action of flatChatActions())
    assert.equal(!action.command, !!action.children || action.id === 'open', action.id);
  // "Open in" and "Export" are submenus of the chat menus only. They are not actions.
  assert.ok(!flatChatActions().some((action) => ['open-in', 'export'].includes(action.id)));
});

test('run uses the code of the surface, else the session command', () => {
  const calls: string[] = [];
  const pin = chatActions.find((action) => action.id === 'pin')!;
  pin.run({ pin: () => calls.push('own'), command: (name) => calls.push(name) });
  pin.run({ command: (name) => calls.push(name) });
  assert.deepEqual(calls, ['own', 'session-pin']);
});

test('shortcuts are the same in every surface', () => {
  const shortcuts = Object.fromEntries(
    flatChatActions()
      .filter((action) => action.shortcut)
      .map((action) => [
        action.id,
        [chatAccelerator(action.shortcut!, 'mac'), chatAccelerator(action.shortcut!, 'windows')],
      ]),
  );
  assert.deepEqual(shortcuts, {
    'open-beside': ['Cmd+Alt+S', 'Ctrl+Shift+S'],
    rename: ['Cmd+Alt+R', 'Ctrl+Shift+E'],
    pin: ['Cmd+Alt+P', 'Ctrl+Shift+P'],
    archive: ['Cmd+Shift+A', 'Ctrl+Shift+A'],
  });
  const key = (code: string, extra: Partial<KeyboardEvent>) =>
    chatActionForKey(
      { code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra },
      extra.metaKey ? 'mac' : 'windows',
    )?.id;
  assert.equal(key('KeyR', { metaKey: true, altKey: true }), 'rename');
  assert.equal(key('KeyE', { ctrlKey: true, shiftKey: true }), 'rename');
  assert.equal(key('KeyA', { metaKey: true, shiftKey: true }), 'archive');
  assert.equal(key('KeyR', { metaKey: true }), undefined);
  // AltGr sends Ctrl+Alt on Windows. It is not a shortcut.
  assert.equal(key('KeyP', { ctrlKey: true, altKey: true }), undefined);
});

test('the IPC state check keeps only known boolean values', () => {
  assert.equal(parseChatActionState(null), null);
  assert.equal(parseChatActionState({ ...ready, saved: 'yes' }), null);
  assert.deepEqual(parseChatActionState({ ...ready, extra: 1, noChanges: 'no' }), {
    ...ready,
  });
  assert.deepEqual(parseChatActionState({ ...ready, noChanges: true }), {
    ...ready,
    noChanges: true,
  });
  assert.deepEqual(parseChatActionState({ ...ready, noBranchWork: true, pullRequestNumber: 7 }), {
    ...ready,
    noBranchWork: true,
    pullRequestNumber: 7,
  });
  assert.deepEqual(parseChatActionState({ ...ready, pullRequestNumber: -1 }), { ...ready });
});
