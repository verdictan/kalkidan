import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computerAnchor,
  isSettingsSection,
  helperUpdateAnchor,
  runtimeAnchor,
  settingsSections,
  settingsTabLabel,
  settingsTarget,
} from '../src/domain/settings-route';
import { managedSetupTargets } from '../src/domain/verdictan';
import { restoreRoute, routeKey, saveableRoute } from '../src/domain/workspace-route';
import type { Session } from '../src/domain/conversation';

test('Settings has five sections in order', () => {
  assert.deepEqual(
    settingsSections.map((section) => section.label),
    ['General', 'Account', 'Agents', 'Computers', 'Data', 'About'],
  );
  assert.equal(isSettingsSection('computers'), true);
  assert.equal(isSettingsSection('remote'), false);
  assert.equal(isSettingsSection('accounts'), false);
  assert.equal(settingsTabLabel('updates'), 'Computers');
  assert.equal(settingsTabLabel('accounts'), 'Account');
});

test('older section names and anchors open their new section', () => {
  assert.deepEqual(settingsTarget(), { tab: 'general', anchor: undefined });
  assert.deepEqual(settingsTarget('unknown'), { tab: 'general', anchor: undefined });
  assert.deepEqual(settingsTarget('accounts'), { tab: 'account', anchor: undefined });
  assert.deepEqual(settingsTarget('updates'), { tab: 'computers', anchor: 'runtime-local' });
  assert.deepEqual(settingsTarget('remote-hosts'), { tab: 'computers', anchor: undefined });
  assert.deepEqual(settingsTarget('about'), { tab: 'about', anchor: undefined });
  assert.deepEqual(settingsTarget(undefined, 'settings-about'), {
    tab: 'about',
    anchor: 'settings-about',
  });
  assert.deepEqual(settingsTarget('remote'), { tab: 'computers', anchor: undefined });
  assert.deepEqual(settingsTarget('managed-agents'), {
    tab: 'agents',
    anchor: 'managed-agent-setup',
  });
  assert.deepEqual(settingsTarget('managed-agents', 'verdictan-account'), {
    tab: 'account',
    anchor: 'verdictan-account',
  });
  assert.deepEqual(settingsTarget('managed-agents', 'verdictan-region'), {
    tab: 'account',
    anchor: 'verdictan-region',
  });
  assert.deepEqual(settingsTarget('managed-agents', 'verdictan-runtime'), {
    tab: 'computers',
    anchor: 'runtime-local',
  });
  assert.deepEqual(settingsTarget('agents', 'agent-program-h1-claude'), {
    tab: 'agents',
    anchor: 'agent-program-h1-claude',
  });
  assert.deepEqual(settingsTarget('general', 'settings-agents'), {
    tab: 'agents',
    anchor: 'settings-agents',
  });
  assert.deepEqual(settingsTarget('updates', computerAnchor('h1')), {
    tab: 'computers',
    anchor: 'computer-h1',
  });
  assert.deepEqual(settingsTarget(undefined, runtimeAnchor('h1')), {
    tab: 'computers',
    anchor: 'runtime-h1',
  });
  assert.deepEqual(settingsTarget('updates', helperUpdateAnchor('h1')), {
    tab: 'computers',
    anchor: 'helper-update-h1',
  });
  // The removed Updates tab opens Computers, at the runtime of this computer by default.
  assert.deepEqual(settingsTarget('updates'), { tab: 'computers', anchor: 'runtime-local' });
  assert.deepEqual(settingsTarget('updates', 'unknown-anchor'), {
    tab: 'computers',
    anchor: 'unknown-anchor',
  });
});

test('each managed setup step opens a section that holds its anchor', () => {
  for (const target of Object.values(managedSetupTargets)) {
    const resolved = settingsTarget(target.section, target.anchor);
    assert.equal(resolved.tab, target.section, target.anchor);
    assert.equal(resolved.anchor, target.anchor);
  }
});

test('the Settings route has a key per tab and is not saved for the next launch', () => {
  assert.equal(routeKey({ kind: 'settings', tab: 'agents' }), 'settings:agents');
  assert.equal(saveableRoute({ kind: 'settings', tab: 'agents' }), null);
  const session = { id: 's1', agent: 'codex' } as Session;
  const saved = saveableRoute({
    kind: 'conversation',
    session,
    parent: { kind: 'settings', tab: 'general' },
  });
  assert.deepEqual(saved && 'parent' in saved && saved.parent, { kind: 'home' });
  assert.equal(restoreRoute({ kind: 'settings', tab: 'general' }, [], [], []), null);
});
