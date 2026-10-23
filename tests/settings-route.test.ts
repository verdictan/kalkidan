import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentNeedsUser,
  computerAnchor,
  computersNeedUser,
  isSettingsSection,
  helperUpdateAnchor,
  paneGroupId,
  projectPane,
  runtimeAnchor,
  settingsPane,
  settingsPanes,
  settingsPlace,
  settingsTabLabel,
  settingsTarget,
} from '../src/domain/settings-route';
import { managedSetupTargets } from '../src/domain/verdictan';
import { restoreRoute, routeKey, saveableRoute } from '../src/domain/workspace-route';
import type { Session } from '../src/domain/conversation';

test('Settings is one page: the account, Tools, Preferences, then the project', () => {
  assert.deepEqual(
    settingsPanes.map((section) => section.label),
    ['Account', 'Tools', 'Preferences'],
  );
  assert.equal(projectPane('g1'), 'project:g1');
  assert.equal(paneGroupId('project:g1'), 'g1');
  assert.equal(paneGroupId('project:'), undefined);
  assert.equal(paneGroupId('general'), undefined);
  assert.equal(isSettingsSection('computers'), true);
  assert.equal(isSettingsSection('tools'), true);
  assert.equal(isSettingsSection('remote'), false);
  assert.equal(isSettingsSection('accounts'), false);
  assert.equal(settingsTabLabel('updates'), 'Tools');
  assert.equal(settingsTabLabel('accounts'), 'Account');
  assert.equal(settingsTabLabel('agents'), 'Tools');
  assert.equal(settingsTabLabel('about'), 'Preferences');
  assert.equal(settingsTabLabel('general'), 'Settings');
});

test('older section names and anchors keep their older target', () => {
  assert.deepEqual(settingsTarget(), { tab: 'general', anchor: undefined });
  assert.deepEqual(settingsTarget('unknown'), { tab: 'general', anchor: undefined });
  assert.deepEqual(settingsTarget('accounts'), { tab: 'account', anchor: undefined });
  assert.deepEqual(settingsTarget('tools'), { tab: 'tools', anchor: undefined });
  assert.deepEqual(settingsTarget('updates'), { tab: 'computers', anchor: 'runtime-local' });
  assert.deepEqual(settingsTarget('remote-hosts'), { tab: 'computers', anchor: undefined });
  assert.deepEqual(settingsTarget('managed-agents'), {
    tab: 'agents',
    anchor: 'managed-agent-setup',
  });
  assert.deepEqual(settingsTarget('managed-agents', 'verdictan-runtime'), {
    tab: 'computers',
    anchor: 'runtime-local',
  });
  assert.deepEqual(settingsTarget('updates', helperUpdateAnchor('h1')), {
    tab: 'computers',
    anchor: 'helper-update-h1',
  });
  // A project section passes through, with its anchor.
  assert.deepEqual(settingsTarget('project:g1', 'board'), { tab: 'project:g1', anchor: 'board' });
});

test('every older section name opens its part of the one Settings page', () => {
  const cases: [string | undefined, string | undefined, string, string | undefined][] = [
    [undefined, undefined, 'general', undefined],
    ['general', undefined, 'general', undefined],
    ['about', undefined, 'preferences', undefined],
    ['preferences', undefined, 'preferences', undefined],
    ['unknown', undefined, 'general', undefined],
    ['account', undefined, 'account', undefined],
    ['accounts', undefined, 'account', undefined],
    ['tools', undefined, 'tools', undefined],
    ['agents', undefined, 'tools', undefined],
    ['computers', undefined, 'tools', undefined],
    ['remote', undefined, 'tools', undefined],
    ['remote-hosts', undefined, 'tools', undefined],
    ['updates', undefined, 'tools', undefined],
    ['managed-agents', undefined, 'tools', undefined],
  ];
  for (const [section, anchor, pane, focus] of cases)
    assert.deepEqual(settingsPane(section, anchor), { pane, anchor: focus }, String(section));
});

test('every older anchor opens the part that holds it now', () => {
  const cases: [string | undefined, string, string, string | undefined][] = [
    [undefined, 'settings-about', 'preferences', 'settings-about'],
    [undefined, 'settings-data', 'preferences', 'settings-data'],
    ['general', 'settings-notifications', 'preferences', 'settings-notifications'],
    [undefined, 'settings-default-agent', 'tools', undefined],
    [undefined, 'verdictan-account', 'account', 'verdictan-account'],
    ['managed-agents', 'verdictan-account', 'account', 'verdictan-account'],
    ['account', 'verdictan-region', 'account', 'verdictan-region'],
    ['account', 'settings-connected-services', 'tools', 'settings-github'],
    [undefined, 'settings-github', 'tools', 'settings-github'],
    ['general', 'settings-agents', 'tools', 'settings-agents'],
    ['agents', 'agent-program-h1-claude', 'tools', undefined],
    [undefined, 'managed-agent-setup', 'tools', undefined],
    ['managed-agents', 'verdictan-runtime', 'tools', undefined],
    [undefined, runtimeAnchor('h1'), 'tools', undefined],
    ['updates', computerAnchor('h1'), 'tools', 'computer-h1'],
    ['updates', computerAnchor(), 'tools', undefined],
    ['updates', helperUpdateAnchor('h1'), 'tools', undefined],
    ['updates', 'unknown-anchor', 'tools', undefined],
  ];
  for (const [section, anchor, pane, focus] of cases)
    assert.deepEqual(settingsPane(section, anchor), { pane, anchor: focus }, anchor);
});

test('a project section opens with its part of the page', () => {
  assert.deepEqual(settingsPane('project:g1'), { pane: 'project:g1', anchor: undefined });
  assert.deepEqual(settingsPane('project:g1', 'roadmap-dates'), {
    pane: 'project:g1',
    anchor: 'roadmap-dates',
  });
  // An empty project ID is not a project section.
  assert.deepEqual(settingsPane('project:'), { pane: 'general', anchor: undefined });
});

test('each managed setup step opens a part of the page', () => {
  for (const target of Object.values(managedSetupTargets)) {
    const resolved = settingsTarget(target.section, target.anchor);
    assert.equal(resolved.tab, target.section, target.anchor);
    assert.equal(resolved.anchor, target.anchor);
    const pane = settingsPane(target.section, target.anchor);
    assert.ok(['account', 'tools', 'preferences', 'general'].includes(pane.pane), target.anchor);
  }
});

test('every request opens the one Settings window, never a page or a menu', () => {
  for (const [section, anchor] of [
    [undefined, undefined],
    ['agents', undefined],
    ['computers', 'computer-h1'],
    ['general', 'settings-notifications'],
    ['account', 'settings-connected-services'],
    ['project:g1', 'board'],
  ])
    assert.equal(settingsPlace(section, anchor).place, 'preferences');
  // The anchor that the shell passes on is the anchor of the new section.
  assert.deepEqual(settingsPlace('account', 'settings-connected-services'), {
    place: 'preferences',
    anchor: 'settings-github',
  });
  assert.deepEqual(settingsPlace('agents'), { place: 'preferences', anchor: undefined });
  assert.deepEqual(settingsPlace('general', 'settings-notifications'), {
    place: 'preferences',
    anchor: 'settings-notifications',
  });
  // The shell sends the older target to the dialog. The dialog maps it the same way.
  for (const [section, anchor] of [
    ['agents', undefined],
    ['updates', undefined],
    [undefined, 'settings-github'],
    ['account', 'settings-connected-services'],
    ['general', 'settings-notifications'],
  ]) {
    const target = settingsTarget(section, anchor);
    const place = settingsPlace(section, anchor);
    assert.deepEqual(settingsPane(target.tab, place.anchor), settingsPane(section, anchor));
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

test('Computers needs the user only for a missing or old agent, or a failed runtime', () => {
  assert.equal(agentNeedsUser(undefined), false);
  assert.equal(agentNeedsUser({ agent: 'codex', status: 'unavailable' }), false);
  assert.equal(agentNeedsUser({ agent: 'codex', status: 'missing' }), true);
  assert.equal(agentNeedsUser({ agent: 'codex', status: 'installed', version: '0.164.0' }), false);
  assert.equal(agentNeedsUser({ agent: 'claude', status: 'installed', version: '2.1.287' }), true);
  assert.equal(agentNeedsUser({ agent: 'claude', status: 'installed', version: '2.1.300' }), false);
  // A version that Kalkidan cannot read does not ask the user.
  assert.equal(agentNeedsUser({ agent: 'claude', status: 'installed' }), false);
  assert.equal(computersNeedUser(undefined), false);
  assert.equal(computersNeedUser([], true), true);
  assert.equal(
    computersNeedUser([
      { agent: 'codex', status: 'installed', version: '0.164.0' },
      { agent: 'claude', status: 'installed', version: '2.1.287' },
    ]),
    true,
  );
});
