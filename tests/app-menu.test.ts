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
  test(`Session, File and Help menus send their commands (mac: ${mac})`, () => {
    const sent: string[] = [];
    const template = menu(mac, sent);
    const expected: [string, string, string][] = [
      ['File', 'Add code folder…', 'add-code-folder'],
      ['File', 'New task', 'new-task'],
      ['Session', 'New session', 'session-new'],
      ['Session', 'Terminal', 'session-terminal'],
      ['Session', 'Changes', 'session-changes'],
      ['Session', 'Rename…', 'session-rename'],
      ['Session', 'Pin', 'session-pin'],
      ['Session', 'Open a second chat beside this one', 'session-side-chat'],
      ['Session', 'Commit…', 'session-commit'],
      ['Session', 'Archive', 'session-archive'],
      ['Help', 'Get started', 'get-started'],
      ['Help', 'Keyboard shortcuts', 'shortcuts'],
    ];
    for (const [menuLabel, label] of expected)
      (item(submenu(template, menuLabel), label).click as () => void)();
    assert.deepEqual(
      sent,
      expected.map(([, , command]) => command),
    );
    // The Session menu comes before the Window menu.
    const order = template.map((entry) => entry.label);
    assert.ok(order.indexOf('Session') < order.indexOf('Window'));
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
    const session = submenu(menu(mac), 'Session');
    assert.equal(item(session, 'Terminal').registerAccelerator, false);
    assert.equal(item(session, 'Changes').registerAccelerator, false);
    assert.equal(item(session, 'New session').accelerator, 'CmdOrCtrl+Shift+N');
  });
