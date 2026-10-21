import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayVersion,
  managedSteps,
  runtimeInstallable,
  runtimeNewerNotApproved,
  runtimeStatusLabel,
  updatePhaseLabel,
} from '../src/lib/verdictan-labels';
import type { ComponentUpdateStatus } from '../src/domain/updates';

const release = (version: string, c: string) => ({
  version,
  releaseId: version,
  sha256: c.repeat(64),
});
const base: ComponentUpdateStatus = {
  hostId: 'local',
  component: 'verdictan',
  discovery: 'blocked',
  stale: false,
  history: [],
};

test('an approved release installs even when a newer release is not approved', () => {
  const status = { ...base, approved: release('0.3.0', 'a'), discovered: release('0.6.1', 'b') };
  assert.equal(runtimeInstallable(status), true);
  assert.equal(runtimeNewerNotApproved(status), true);
  assert.deepEqual(runtimeStatusLabel(status), { label: 'Not installed', tone: 'warning' });
  assert.equal(runtimeInstallable({ ...status, canInstallApproved: false }), false);
  assert.equal(runtimeNewerNotApproved({ ...status, notice: 'Newer release' }), false);
});

test('the installed approved release is up to date', () => {
  const approved = release('0.3.0', 'a');
  const status = { ...base, discovery: 'current' as const, approved, installed: approved };
  assert.equal(runtimeInstallable(status), false);
  assert.equal(runtimeStatusLabel(status).label, 'Installed 0.3.0');
});

test('labels use plain words', () => {
  assert.equal(updatePhaseLabel('waiting-for-idle'), 'Waiting for active work to stop');
  assert.equal(displayVersion('1.5.0-build.17925.4a1a9a9'), '1.5.0');
  const steps = managedSteps(
    { phase: 'authenticated', executionReady: false },
    {
      status: 'ok',
      teams: [],
      policies: [],
      providerConnections: [],
      selections: {
        claude: {
          teamId: 't',
          configurationId: 'c',
          configurationVersionId: 'v',
          providerConnectionId: 'p',
          model: 'm',
        },
      },
    },
  );
  assert.deepEqual(steps, { runtime: true, signedIn: true, codex: false, claude: true });
});
