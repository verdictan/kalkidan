import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { appMenuTemplate } from '../electron/app-menu';

// Proper names keep their capital letters in sentence case.
const properNames = new Set(['Kalkidan']);

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
      ['Go', 'Docs', 'go-docs'],
      ['Go', 'Memory', 'go-memory'],
      ['Go', 'Insights', 'go-insights'],
      ['Go', 'All chats', 'all-sessions'],
      ['Chat', 'New chat', 'session-new'],
      ['Chat', 'Terminal', 'session-terminal'],
      ['Chat', 'Changes', 'session-changes'],
      ['Chat', 'Rename…', 'session-rename'],
      ['Chat', 'Pin', 'session-pin'],
      ['Chat', 'Open a second chat beside this one', 'session-side-chat'],
      ['Chat', 'Commit…', 'session-commit'],
      ['Chat', 'Open linked task', 'open-linked-task'],
      ['Chat', 'Link task…', 'link-task'],
      ['Chat', 'Open pull request', 'open-pull-request'],
      ['Chat', 'Archive', 'session-archive'],
      [mac ? 'Kalkidan' : 'Help', 'Check for updates…', 'check-updates'],
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
    // Each menu shows Check for updates once.
    assert.equal(labels(template).filter((label) => label === 'Check for updates…').length, 1);
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
    assert.equal(item(session, 'New chat').accelerator, 'CmdOrCtrl+Shift+N');
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
      ['Overview', 'Tasks', 'Docs', 'Memory', 'Insights', 'All chats'].map(
        (label) => item(go, label).accelerator,
      ),
      [
        'CmdOrCtrl+1',
        'CmdOrCtrl+2',
        'CmdOrCtrl+3',
        'CmdOrCtrl+4',
        'CmdOrCtrl+5',
        'CmdOrCtrl+Shift+L',
      ],
    );
    assert.equal(item(submenu(menu(mac), 'File'), 'New task').accelerator, 'CmdOrCtrl+Shift+K');
  });
