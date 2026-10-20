import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileRoute,
  resolveRouteSession,
  routeKey,
  type WorkspaceRoute,
} from '../src/domain/workspace-route';
import type { Session } from '../src/domain/conversation';
test('route reconciliation removes stale entities and resolves draft history without changing another host', () => {
  const session = { id: 'draft', agent: 'codex', hostId: 'host' } as Session;
  const route: WorkspaceRoute = {
    kind: 'conversation',
    repositoryId: 'r',
    session,
    parent: { kind: 'project', groupId: 'g', page: 'docs' },
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
