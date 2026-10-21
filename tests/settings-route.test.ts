import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computerAnchor,
  isSettingsTab,
  runtimeAnchor,
  settingsTabLabel,
  settingsTabs,
  settingsTarget,
} from '../src/domain/settings-route';
import { managedSetupTargets } from '../src/domain/verdictan';
import { restoreRoute, routeKey, saveableRoute } from '../src/domain/workspace-route';
import type { Session } from '../src/domain/conversation';

test('Settings has five tabs in order', () => {
  assert.deepEqual(
    settingsTabs.map((tab) => tab.label),
    ['General', 'Accounts', 'Agents', 'Computers', 'Updates'],
  );
  assert.equal(isSettingsTab('computers'), true);
  assert.equal(isSettingsTab('remote'), false);
  assert.equal(settingsTabLabel('updates'), 'Updates');
});

test('older section names and anchors open their new tab', () => {
  assert.deepEqual(settingsTarget(), { tab: 'general', anchor: undefined });
  assert.deepEqual(settingsTarget('unknown'), { tab: 'general', anchor: undefined });
  assert.deepEqual(settingsTarget('accounts'), { tab: 'accounts', anchor: undefined });
  assert.deepEqual(settingsTarget('about'), { tab: 'general', anchor: 'settings-about' });
  assert.deepEqual(settingsTarget('remote'), { tab: 'computers', anchor: undefined });
  assert.deepEqual(settingsTarget('managed-agents'), {
    tab: 'agents',
    anchor: 'managed-agent-setup',
  });
  assert.deepEqual(settingsTarget('managed-agents', 'verdictan-account'), {
    tab: 'accounts',
    anchor: 'verdictan-account',
  });
  assert.deepEqual(settingsTarget('managed-agents', 'verdictan-region'), {
    tab: 'accounts',
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
  assert.deepEqual(settingsTarget('updates', 'unknown-anchor'), {
    tab: 'updates',
    anchor: 'unknown-anchor',
  });
});

test('each managed setup step opens a tab that holds its anchor', () => {
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
