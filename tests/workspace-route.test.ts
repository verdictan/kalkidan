import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectPageOf,
  reconcileRoute,
  resolveRouteSession,
  restoreRoute,
  routeKey,
  saveableRoute,
  type WorkspaceRoute,
} from '../src/domain/workspace-route';
import type { Session } from '../src/domain/conversation';
test('route reconciliation removes stale entities and resolves draft history without changing another host', () => {
  const session = { id: 'draft', agent: 'codex', hostId: 'host' } as Session;
  const route: WorkspaceRoute = {
    kind: 'conversation',
    repositoryId: 'r',
    session,
    parent: { kind: 'project', groupId: 'g', page: 'knowledge', section: 'pages' },
  };
  const next = reconcileRoute(route, [], [{ id: 'r' }]);
  assert.equal(next.kind, 'conversation');
  assert.deepEqual(next.kind === 'conversation' && next.parent, { kind: 'home' });
  assert.deepEqual(reconcileRoute(route, [{ id: 'g' }], []), { kind: 'home' });
  const resolved = resolveRouteSession(route, session, { ...session, id: 'real' });
  assert.notEqual(routeKey(resolved), routeKey(route));
  assert.equal(resolveRouteSession(route, { ...session, hostId: 'different' }, session), route);
  assert.equal(reconcileRoute(route, [{ id: 'g' }], [{ id: 'r' }]), route);
});

test('saved routes restore only when their project, folder and chat still exist', () => {
  const session = { id: 's1', agent: 'codex', cwd: '/r' } as Session;
  const parent = { kind: 'project' as const, groupId: 'g', page: 'knowledge' as const };
  const saved = JSON.parse(
    JSON.stringify(saveableRoute({ kind: 'conversation', session, parent })),
  ) as unknown;
  const restored = restoreRoute(saved, [{ id: 'g' }], [{ id: 'r' }], [session]);
  assert.equal(restored?.kind, 'conversation');
  assert.deepEqual(restoreRoute(saved, [{ id: 'g' }], [], []), parent);
  assert.deepEqual(restoreRoute(saved, [], [], []), { kind: 'home' });
  assert.deepEqual(
    saveableRoute({ kind: 'conversation', session: { ...session, id: 'draft-1' }, parent }),
    parent,
  );
  assert.equal(restoreRoute({ kind: 'project', groupId: 'g', page: 'nope' }, [], [], []), null);
  assert.equal(restoreRoute('junk', [], [], []), null);
});

test('older project pages open Knowledge at their section', () => {
  assert.deepEqual(projectPageOf('docs'), { page: 'knowledge', section: 'pages' });
  assert.deepEqual(projectPageOf('memory'), { page: 'knowledge', section: 'memory' });
  assert.deepEqual(projectPageOf('insights'), { page: 'knowledge', section: 'insights' });
  assert.deepEqual(projectPageOf('chats'), { page: 'chats' });
  assert.equal(projectPageOf('nope'), null);
  assert.deepEqual(
    restoreRoute({ kind: 'project', groupId: 'g', page: 'memory' }, [{ id: 'g' }], [], []),
    { kind: 'project', groupId: 'g', page: 'knowledge', section: 'memory' },
  );
  // Computers is a section of Settings now. A saved Computers route opens Projects.
  assert.deepEqual(restoreRoute({ kind: 'computers' }, [], [], []), { kind: 'home' });
  // Insights left Knowledge. A saved Insights route opens Tasks.
  assert.deepEqual(
    restoreRoute({ kind: 'project', groupId: 'g', page: 'insights' }, [{ id: 'g' }], [], []),
    { kind: 'project', groupId: 'g', page: 'tasks' },
  );
});

test('the Waiting for you page is a route of its own that a launch restores', () => {
  const route: WorkspaceRoute = { kind: 'waiting' };
  assert.equal(routeKey(route), 'waiting');
  const saved = JSON.parse(JSON.stringify(saveableRoute(route))) as unknown;
  assert.deepEqual(restoreRoute(saved, [], [], []), { kind: 'waiting' });
});
