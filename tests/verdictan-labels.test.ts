import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayVersion,
  managedSteps,
  memoryEmptyAction,
  runtimeInstallable,
  runtimeOutdated,
  runtimeProgressLabel,
  runtimeReady,
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

test('the latest signed release installs when it is not installed', () => {
  const status = { ...base, latest: release('0.6.6', 'a') };
  assert.equal(runtimeInstallable(status), true);
  assert.deepEqual(runtimeStatusLabel(status), { label: 'Not installed', tone: 'warning' });
  assert.equal(runtimeInstallable({ ...status, canInstall: false }), false);
  const outdated = { ...status, installed: release('0.6.5', 'b') };
  assert.equal(runtimeOutdated(outdated), true);
  assert.deepEqual(runtimeStatusLabel(outdated), { label: 'Update ready', tone: 'warning' });
});

test('the installed latest release is up to date', () => {
  const latest = release('0.3.0', 'a');
  const status = { ...base, discovery: 'current' as const, latest, installed: latest };
  assert.equal(runtimeInstallable(status), false);
  assert.equal(runtimeStatusLabel(status).label, 'Ready');
});

test('install progress uses plain words', () => {
  assert.equal(runtimeProgressLabel('verifying', '0.6.9'), 'Verifying version 0.6.9…');
  assert.equal(
    runtimeProgressLabel('downloading', '0.6.9', 41.6),
    'Downloading version 0.6.9 · 42%',
  );
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

test('the empty memory page chooses its call to action from the managed agent steps', () => {
  const ready = { runtime: true, signedIn: true, codex: false, claude: true };
  assert.equal(memoryEmptyAction(ready), 'start-chat');
  assert.equal(memoryEmptyAction({ ...ready, claude: false, codex: true }), 'start-chat');
  assert.equal(memoryEmptyAction({ ...ready, claude: false }), 'set-up');
  assert.equal(memoryEmptyAction({ ...ready, signedIn: false }), 'set-up');
  assert.equal(memoryEmptyAction({ ...ready, runtime: false }), 'set-up');
  assert.equal(memoryEmptyAction(undefined), undefined);
  assert.equal(
    memoryEmptyAction(
      managedSteps({ phase: 'authenticated', executionReady: true }, {
        selections: { claude: {} },
      } as never),
    ),
    'start-chat',
  );
  assert.equal(
    memoryEmptyAction(managedSteps({ phase: 'missing', executionReady: false }, undefined)),
    'set-up',
  );
});

test('the runtime step comes from the installer status, not the account phase', () => {
  const latest = release('0.6.9', 'a');
  const installed = { ...base, discovery: 'current' as const, latest, installed: latest };
  assert.equal(runtimeReady(installed), true);
  assert.equal(runtimeReady({ ...base, latest }), false);
  // The account phase says "missing", but the installer has the runtime.
  const missing = { phase: 'missing' as const, executionReady: false };
  assert.equal(managedSteps(missing, undefined, installed).runtime, true);
  // The account phase says signed in, but the installer has no runtime.
  const signedIn = { phase: 'authenticated' as const, executionReady: true };
  assert.equal(managedSteps(signedIn, undefined, { ...base, latest }).runtime, false);
  assert.equal(memoryEmptyAction(managedSteps(signedIn, undefined, { ...base, latest })), 'set-up');
});
