import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appearanceStorageKey,
  applyAppearance,
  readAppearance,
  saveAppearance,
  schemeFromSearch,
} from '../src/lib/appearance';

// Small stand-ins for the browser globals that the helper uses.
function installBrowser(systemDark: boolean) {
  const store = new Map<string, string>();
  const listeners = new Set<() => void>();
  const classes = new Set<string>();
  const meta = { content: '' };
  const media = {
    matches: systemDark,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
    window: { matchMedia: () => media },
    // The theme sets --chrome for the current class.
    getComputedStyle: () => ({
      getPropertyValue: (name: string) =>
        name === '--chrome' ? (classes.has('dark') ? ' #22272b' : ' #eef0f2') : '',
    }),
    document: {
      documentElement: {
        classList: {
          toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        },
      },
      querySelector: () => ({
        setAttribute: (_: string, value: string) => (meta.content = value),
      }),
    },
  });
  return {
    store,
    listeners,
    dark: () => classes.has('dark'),
    themeColor: () => meta.content,
    setSystem(dark: boolean) {
      media.matches = dark;
      for (const fn of listeners) fn();
    },
  };
}

test('appearance reads "system" when nothing valid is saved', () => {
  const browser = installBrowser(false);
  assert.equal(readAppearance(), 'system');
  browser.store.set(appearanceStorageKey, 'sepia');
  assert.equal(readAppearance(), 'system');
  saveAppearance('dark');
  assert.equal(readAppearance(), 'dark');
});

test('appearance follows the system only in system mode', () => {
  const browser = installBrowser(true);
  applyAppearance('system');
  assert.equal(browser.dark(), true);
  assert.equal(browser.themeColor(), '#22272b');
  browser.setSystem(false);
  assert.equal(browser.dark(), false);
  applyAppearance('dark');
  assert.equal(browser.listeners.size, 0);
  browser.setSystem(false);
  assert.equal(browser.dark(), true);
  applyAppearance('light');
  assert.equal(browser.dark(), false);
  assert.equal(browser.themeColor(), '#eef0f2');
});

test('scheme query reads dark or light only', () => {
  assert.equal(schemeFromSearch('?scheme=dark'), 'dark');
  assert.equal(schemeFromSearch('?theme=light'), 'light');
  assert.equal(schemeFromSearch('?scheme=sepia'), null);
  assert.equal(schemeFromSearch(''), null);
});
