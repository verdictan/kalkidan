import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate } from '../electron/app-menu';
import {
  chatActionMenu,
  sessionActionState,
  type ChatActionState,
} from '../src/domain/chat-actions';

// Proper names keep their capital letters in sentence case.
const properNames = new Set([
  'Kalkidan',
  'Markdown',
  'HTML',
  'Markdown…',
  'HTML…',
  'Docs…',
  'VS',
  'Code',
  'Cursor',
  'ID',
  'Finder',
  'File',
  'Explorer',
  'Verdictan…',
]);

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.type === 'separator' ? [] : [item.label ?? `<role ${item.role} without label>`]),
    ...(Array.isArray(item.submenu) ? labels(item.submenu) : []),
  ]);
}

for (const mac of [true, false])
  for (const packaged of [true, false])
    test(`menu labels use sentence case (mac: ${mac}, packaged: ${packaged})`, () => {
      const template = appMenuTemplate({
        mac,
        packaged,
        appName: 'Kalkidan',
        command: () => () => {},
        openExternal: () => {},
      });
      for (const label of labels(template)) {
        assert.ok(!label.startsWith('<role'), label);
        const [, ...rest] = label.split(' ');
        for (const word of rest)
          assert.ok(
            properNames.has(word) || word[0] === word[0].toLowerCase(),
            `"${label}" is not sentence case`,
          );
      }
    });

test('packaged builds hide Reload and the developer tools', () => {
  const template = appMenuTemplate({
    mac: true,
    packaged: true,
    appName: 'Kalkidan',
    command: () => () => {},
    openExternal: () => {},
  });
  const all = labels(template);
  assert.ok(!all.includes('Reload'));
  assert.ok(!all.includes('Toggle developer tools'));
});

for (const mac of [true, false])
  test(`File menu has Close tab on the primary key and Close window with Shift (mac: ${mac})`, () => {
    const sent: string[] = [];
    const template = appMenuTemplate({
      mac,
      packaged: true,
      appName: 'Kalkidan',
      command: (name) => () => sent.push(name),
      openExternal: () => {},
    });
    const file = template.find((item) => item.label === 'File')!
      .submenu as MenuItemConstructorOptions[];
    const tab = file.find((item) => item.label === 'Close tab')!;
    assert.equal(tab.accelerator, 'CmdOrCtrl+W');
    (tab.click as () => void)();
    assert.deepEqual(sent, ['close-tab']);
    const window = file.find((item) => item.label === 'Close window')!;
    assert.equal(window.role, 'close');
    assert.equal(window.accelerator, 'Shift+CmdOrCtrl+W');
    const all = template.flatMap((item) =>
      Array.isArray(item.submenu) ? item.submenu : [],
    ) as MenuItemConstructorOptions[];
    // No other item takes the primary key and W.
    assert.equal(all.filter((item) => item.accelerator === 'CmdOrCtrl+W').length, 1);
    assert.ok(all.every((item) => item.role !== 'close' || item.accelerator));
  });

function menu(mac: boolean, sent: string[] = []) {
  return appMenuTemplate({
    mac,
    packaged: true,
    appName: 'Kalkidan',
    command: (name) => () => sent.push(name),
    openExternal: () => {},
  });
}
function submenu(template: MenuItemConstructorOptions[], label: string) {
  return template.find((item) => item.label === label)!.submenu as MenuItemConstructorOptions[];
}
function item(items: MenuItemConstructorOptions[], label: string) {
  const found = items.find((entry) => entry.label === label);
  assert.ok(found, `${label} is missing`);
  return found;
}

for (const mac of [true, false])
  test(`Chat, File, Go and Help menus send their commands (mac: ${mac})`, () => {
    const sent: string[] = [];
    const template = menu(mac, sent);
    const expected: [string, string, string][] = [
      ['File', 'Add code folder…', 'add-code-folder'],
      ['File', 'New task', 'new-task'],
      ['Go', 'Overview', 'go-overview'],
      ['Go', 'Tasks', 'go-tasks'],
      ['Go', 'Chats', 'go-chats'],
      ['Go', 'Knowledge', 'go-knowledge'],
      ['Go', 'All chats', 'all-sessions'],
      ['Go', 'Computers', 'go-computers'],
      ['Chat', 'New chat', 'session-new'],
      ['Chat', 'Terminal', 'session-terminal'],
      ['Chat', 'Changes', 'session-changes'],
      ['Chat', 'Open side chat', 'session-side-chat'],
      ['Chat', 'Rename…', 'session-rename'],
      ['Chat', 'Pin', 'session-pin'],
      ['Chat', 'Link task…', 'link-task'],
      ['Chat', 'Commit changes…', 'session-commit'],
      ['Chat', 'Archive', 'session-archive'],
      ['Help', 'Get started', 'get-started'],
      ['Help', 'Keyboard shortcuts', 'shortcuts'],
    ];
    for (const [menuLabel, label] of expected)
      (item(submenu(template, menuLabel), label).click as () => void)();
    assert.deepEqual(
      sent,
      expected.map(([, , command]) => command),
    );
    // The Chat menu comes before the Window menu.
    const order = template.map((entry) => entry.label);
    assert.ok(order.indexOf('Chat') < order.indexOf('Window'));
    // Kalkidan does not update itself, so no menu checks for updates.
    assert.ok(!labels(template).some((label) => /update/i.test(label)));
  });

for (const mac of [true, false])
  test(`no two menu items register the same accelerator (mac: ${mac})`, () => {
    const all = menu(mac).flatMap((entry) =>
      Array.isArray(entry.submenu) ? entry.submenu : [],
    ) as MenuItemConstructorOptions[];
    // Two items with the same role do the same thing, so they can share a key.
    const registered = all
      .filter((entry) => entry.accelerator && entry.registerAccelerator !== false)
      .map(
        (entry) =>
          String(entry.accelerator).replace('Shift+CmdOrCtrl', 'CmdOrCtrl+Shift') +
          (entry.role ? ` ${entry.role}` : ` ${entry.label}`),
      );
    const keys = [...new Set(registered)].map((entry) => entry.split(' ')[0]);
    assert.equal(new Set(keys).size, keys.length, keys.join(', '));
    // The session view handles these keys, so the menu must not take them first.
    const session = submenu(menu(mac), 'Chat');
    assert.equal(item(session, 'Terminal').registerAccelerator, false);
    assert.equal(item(session, 'Changes').registerAccelerator, false);
    assert.equal(item(session, 'New chat').accelerator, 'CmdOrCtrl+N');
    const file = submenu(menu(mac), 'File');
    assert.equal(item(file, 'New project').accelerator, 'CmdOrCtrl+Shift+N');
    // No other item, also one that the renderer handles, shows these keys.
    const shown = all.map((entry) =>
      String(entry.accelerator || '').replace('Shift+CmdOrCtrl', 'CmdOrCtrl+Shift'),
    );
    for (const key of ['CmdOrCtrl+N', 'CmdOrCtrl+Shift+N', 'CmdOrCtrl+4', 'CmdOrCtrl+Shift+K'])
      assert.equal(shown.filter((value) => value === key).length, 1, key);
    // The renderer uses these keys. Menu items must not take them.
    const renderer = [
      'CmdOrCtrl+T',
      'CmdOrCtrl+F',
      'CmdOrCtrl+S',
      'CmdOrCtrl+A',
      'CmdOrCtrl+Shift+A',
      'CmdOrCtrl+Shift+G',
      'CmdOrCtrl+Shift+P',
      'CmdOrCtrl+Shift+S',
      'CmdOrCtrl+Shift+E',
    ];
    for (const key of renderer) assert.ok(!keys.includes(key), key);
    const go = submenu(menu(mac), 'Go');
    assert.deepEqual(
      ['Overview', 'Tasks', 'Chats', 'Knowledge', 'All chats', 'Computers'].map(
        (label) => item(go, label).accelerator,
      ),
      ['CmdOrCtrl+1', 'CmdOrCtrl+2', 'CmdOrCtrl+3', 'CmdOrCtrl+4', 'CmdOrCtrl+Shift+L', undefined],
    );
    // Knowledge holds Docs, Memory and Insights, so they have no menu items of their own.
    for (const label of ['Docs', 'Memory', 'Insights', 'Settings…', 'Settings'])
      assert.ok(!labels(menu(mac)).includes(label), label);
    const settings = mac ? submenu(menu(mac), 'Kalkidan') : file;
    assert.equal(item(settings, 'Preferences…').accelerator, mac ? 'Cmd+,' : 'Ctrl+,');
    assert.equal(item(file, 'New task').accelerator, 'CmdOrCtrl+Shift+K');
    assert.equal(item(go, 'Chats').click !== undefined, true);
    // Sign in shows once: in the app menu on macOS, in File elsewhere.
    const where = mac ? submenu(menu(mac), 'Kalkidan') : file;
    assert.ok(item(where, 'Sign in to Verdictan…'));
  });

const openChat: ChatActionState = sessionActionState(
  { id: 'chat', agent: 'codex', cwd: '/repo', title: 'Chat', updatedAt: '' },
  { open: true, usageHistory: true, repository: true, project: true },
);
function chatMenu(mac: boolean, chat: ChatActionState | null, sent: string[] = []) {
  return submenu(
    appMenuTemplate({
      mac,
      packaged: true,
      appName: 'Kalkidan',
      command: (name) => () => sent.push(name),
      openExternal: () => {},
      platform: mac ? 'mac' : 'linux',
      chat,
    }),
    'Chat',
  );
}
/** The labels of a menu, with "---" for a separator and "›" before a submenu. */
function outline(items: MenuItemConstructorOptions[]): string[] {
  return items.map((entry) =>
    entry.type === 'separator'
      ? '---'
      : Array.isArray(entry.submenu)
        ? `${entry.label} › ${outline(entry.submenu).join(', ')}`
        : String(entry.label),
  );
}

for (const mac of [true, false])
  test(`the Chat menu shows the chat action list in its groups (mac: ${mac})`, () => {
    const items = chatMenu(mac, openChat);
    const platform = mac ? 'mac' : 'linux';
    // The menu starts with New chat, Terminal and Changes. The chat actions follow.
    const actions = outline(items).slice(outline(items).indexOf('Changes') + 2);
    const expected = chatActionMenu('menu-bar', openChat, platform).flatMap((group, index) => [
      ...(index ? ['---'] : []),
      ...group.items.map((item) =>
        item.children
          ? `${item.label} › ${item.children
              .flatMap((child) => [...(child.separator ? ['---'] : []), child.label])
              .join(', ')}`
          : item.label,
      ),
    ]);
    assert.deepEqual(actions, expected);
    assert.deepEqual(actions, [
      'Open side chat',
      'Open in new window',
      '---',
      'Rename…',
      'Pin',
      'Link task…',
      'Notes…',
      '---',
      'Commit changes…',
      'Create pull request…',
      'Fork chat…',
      `Show folder in ${mac ? 'Finder' : 'file manager'}`,
      '---',
      'Share › Export Markdown…, Export HTML…, ---, Save to Docs…',
      'Copy chat as Markdown',
      'Usage history…',
      '---',
      'Developer › Copy chat ID, Copy folder path, ---, Open in VS Code, Open in Cursor',
      '---',
      'Archive',
    ]);
  });

for (const mac of [true, false])
  test(`the Chat menu shows the shortcuts of the chat actions without registering them (mac: ${mac})`, () => {
    const items = chatMenu(mac, openChat);
    const shortcut = (label: string) => {
      const entry = item(items, label);
      assert.equal(entry.registerAccelerator, false, label);
      return entry.accelerator;
    };
    assert.equal(shortcut('Rename…'), mac ? 'Cmd+Alt+R' : 'Ctrl+Shift+E');
    assert.equal(shortcut('Pin'), mac ? 'Cmd+Alt+P' : 'Ctrl+Shift+P');
    assert.equal(shortcut('Open side chat'), mac ? 'Cmd+Alt+S' : 'Ctrl+Shift+S');
    assert.equal(shortcut('Archive'), mac ? 'Cmd+Shift+A' : 'Ctrl+Shift+A');
  });

test('the Chat menu follows the state of the open chat', () => {
  const sent: string[] = [];
  // No open chat: the chat actions are disabled. New chat stays available.
  const closed = chatMenu(true, null);
  assert.equal(item(closed, 'New chat').enabled, undefined);
  assert.equal(item(closed, 'Rename…').enabled, false);
  assert.equal(item(closed, 'Archive').enabled, false);
  // A running chat with a pinned state, a task and a pull request.
  const busy = chatMenu(
    true,
    { ...openChat, running: true, pinned: true, linkedTask: true, pullRequest: true },
    sent,
  );
  assert.equal(item(busy, 'Unpin').enabled, true);
  assert.equal(item(busy, 'Open linked task').enabled, true);
  assert.ok(!busy.some((entry) => entry.label === 'Link task…'));
  // A chat with a pull request shows View pull request in place of Create pull request.
  assert.equal(item(busy, 'View pull request').enabled, true);
  assert.ok(!busy.some((entry) => entry.label === 'Create pull request…'));
  assert.equal(item(busy, 'Commit changes…').enabled, false);
  assert.equal(item(busy, 'Archive').enabled, false);
  // No changes to commit disables Commit changes.
  assert.equal(
    item(chatMenu(true, { ...openChat, noChanges: true }), 'Commit changes…').enabled,
    false,
  );
  // Submenu items send their commands.
  const share = item(chatMenu(true, openChat, sent), 'Share')
    .submenu as MenuItemConstructorOptions[];
  (item(share, 'Export HTML…').click as () => void)();
  (item(busy, 'Unpin').click as () => void)();
  assert.deepEqual(sent, ['session-export-html', 'session-pin']);
});
