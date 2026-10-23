import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectWindows, type ProjectWindow } from '../electron/project-windows';
import { GatewayRuntime, gatewayRuntimeState } from '../electron/gateway-runtime';
import type { ComponentUpdateStatus } from '../src/domain/updates';

class FakeWindow implements ProjectWindow {
  destroyed = false;
  minimized = false;
  focused = 0;
  private closed: (() => void)[] = [];
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.minimized = false;
  }
  show() {}
  focus() {
    this.focused++;
  }
  close() {
    this.destroyed = true;
    this.closed.forEach((listener) => listener());
  }
  once(_event: 'closed', listener: () => void) {
    this.closed.push(listener);
  }
}

test('one window for each project, and the list follows open and close', () => {
  const created: FakeWindow[] = [];
  const events: string[][] = [];
  const windows = new ProjectWindows<FakeWindow>({
    create: () => {
      const window = new FakeWindow();
      created.push(window);
      return window;
    },
    exists: (id) => ['atlas', 'ledger'].includes(id),
    changed: (ids) => events.push(ids),
  });
  windows.open('atlas');
  windows.open('ledger');
  assert.equal(created.length, 2);
  assert.deepEqual(windows.list(), ['atlas', 'ledger']);
  assert.equal(windows.projectOf(created[0]), 'atlas');
  // A second open focuses the window that is open.
  created[0].minimized = true;
  windows.open('atlas');
  assert.equal(created.length, 2);
  assert.equal(created[0].focused, 1);
  assert.equal(created[0].minimized, false);
  // Closing returns the project to the main tree.
  created[0].close();
  assert.deepEqual(windows.list(), ['ledger']);
  windows.close('ledger');
  assert.deepEqual(events, [['atlas'], ['atlas', 'ledger'], ['ledger'], []]);
  assert.throws(() => windows.open('missing'), /Project not found/);
  assert.throws(() => windows.open(42), /Project not found/);
});

const status = (value: Partial<ComponentUpdateStatus>): ComponentUpdateStatus => ({
  hostId: 'local',
  component: 'verdictan',
  discovery: 'current',
  stale: false,
  history: [],
  ...value,
});
const release = { version: '1.0.0', releaseId: 'r1', sha256: 'a'.repeat(64) };

test('gateway runtime state shows only a failure', () => {
  assert.deepEqual(gatewayRuntimeState(undefined), { state: 'unknown' });
  assert.deepEqual(gatewayRuntimeState(status({ installed: release })), { state: 'ready' });
  assert.deepEqual(gatewayRuntimeState(status({ installing: true })), { state: 'working' });
  const failed = gatewayRuntimeState(
    status({
      operation: {
        id: 'o',
        generation: 1,
        sequence: 1,
        hostId: 'local',
        component: 'verdictan',
        phase: 'failed',
        target: release,
        receivedBytes: 0,
        totalBytes: 0,
        startedAt: 0,
        updatedAt: 0,
        error: 'Release /secret/path refused',
      },
    }),
  );
  assert.equal(failed.state, 'failed');
  assert.ok(failed.message && !failed.message.includes('/secret/path'));
});

test('the gateway runtime installs itself when it is missing', async () => {
  let installed = false;
  let installs = 0;
  const runtime = new GatewayRuntime({
    check: async () => status(installed ? { installed: release } : {}),
    install: async () => {
      installs++;
      installed = true;
    },
  });
  const [a, b] = await Promise.all([runtime.ensure(), runtime.ensure()]);
  assert.deepEqual(a, { state: 'ready' });
  assert.deepEqual(b, { state: 'ready' });
  assert.equal(installs, 1);
  await runtime.ensure();
  assert.equal(installs, 1);
});

test('a failed automatic install shows a failure that the user can retry', async () => {
  let fail = true;
  const runtime = new GatewayRuntime({
    check: async () => status(fail ? {} : { installed: release }),
    install: async () => {
      if (fail) throw new Error('network');
    },
  });
  assert.equal((await runtime.ensure()).state, 'failed');
  assert.equal(runtime.current().state, 'failed');
  fail = false;
  assert.deepEqual(await runtime.ensure(), { state: 'ready' });
});
