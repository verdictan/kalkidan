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
