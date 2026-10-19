import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  fileManagerName,
  hasPrimaryModifier,
  pathBasename,
  plural,
  shortcutLabel,
} from '../src/lib/platform';

const key = (state: Partial<{ metaKey: boolean; ctrlKey: boolean; altGraph: boolean }>) => ({
  metaKey: !!state.metaKey,
  ctrlKey: !!state.ctrlKey,
  getModifierState: (name: string) => name === 'AltGraph' && !!state.altGraph,
});

test('detects the desktop platform from the user agent', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
});

test('formats shortcuts for each platform', () => {
  assert.equal(shortcutLabel(['mod', 'shift'], 'A', 'mac'), '⇧⌘A');
  assert.equal(shortcutLabel(['mod', 'alt'], 'R', 'mac'), '⌥⌘R');
  assert.equal(shortcutLabel(['mod', 'shift'], 'A', 'windows'), 'Ctrl+Shift+A');
  assert.equal(shortcutLabel(['mod'], 'K', 'linux'), 'Ctrl+K');
});

test('uses the platform primary modifier and ignores AltGr', () => {
  assert.equal(hasPrimaryModifier(key({ metaKey: true }), 'mac'), true);
  assert.equal(hasPrimaryModifier(key({ ctrlKey: true }), 'mac'), false);
  assert.equal(hasPrimaryModifier(key({ ctrlKey: true }), 'windows'), true);
  assert.equal(hasPrimaryModifier(key({ ctrlKey: true, altGraph: true }), 'windows'), false);
});

test('names the file manager and splits Windows paths', () => {
  assert.equal(fileManagerName('mac'), 'Finder');
  assert.equal(fileManagerName('windows'), 'File Explorer');
  assert.equal(pathBasename('C:\\Users\\me\\repo'), 'repo');
  assert.equal(pathBasename('/home/me/repo/'), 'repo');
});

test('pluralizes counts', () => {
  assert.equal(plural(1, 'session'), '1 session');
  assert.equal(plural(3, 'session'), '3 sessions');
  assert.equal(plural(1, 'match', 'matches'), '1 match');
});
