import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectServices, normalizeProjectResult } from '../electron/verdictan/project-services';
import type { DesktopClient, DesktopOperation } from '../electron/verdictan/protocol';
import { projectServicePermissions } from '../src/domain/project-services';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'project-services-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let permission = true,
    advertised = true,
    consent = false,
    lost = false,
    actor = 'reviewer',
    wrongScope = false;
  const calls: DesktopOperation[] = [];
  const client = {
    request: async (
      operation: DesktopOperation,
      parameters?: { fields?: Record<string, unknown> },
    ) => {
      calls.push(operation);
      const data: Record<string, unknown> =
        operation === 'capabilities'
          ? {
              cli_version: '1.0.0',
              protocol_min: 1,
              protocol_max: 1,
              managed_execution_ready: true,
              tested_agents: [],
              capabilities: advertised
                ? ['project.permissions', 'review.decide', 'context.settings', 'context.search']
                : [],
            }
          : {
              project_scope: {
                organization_id: 'org',
                project_id: wrongScope ? 'other' : 'project',
              },
              actor_id: actor,
              revision: '1',
              observed_at: '2026-10-21T00:00:00Z',
              permissions: permission ? ['review.decide', 'context.read'] : [],
              enabled: consent,
              items: [],
              operation_id: parameters?.fields?.operation_id,
              receipt_id: 'receipt',
              state: 'completed',
            };
      if (operation === 'review.decide' && lost) throw Error('Transport lost');
      return { data };
    },
  } as DesktopClient;
  const service = new ProjectServices(root, async () => ({
    client,
    organizationId: 'org',
    projectId: 'project',
    actorId: actor,
  }));
  return {
    root,
    client,
    service,
    calls,
    permissions: (value: boolean) => {
      permission = value;
    },
    advertise: (value: boolean) => {
      advertised = value;
    },
    consent: (value: boolean) => {
      consent = value;
    },
    lose: () => {
      lost = true;
    },
    scope: () => {
      wrongScope = true;
    },
  };
}
const decision = () => ({
  operation: 'review.decide' as const,
  fields: {
    escalation_id: 'review',
    decision: 'approve',
    reason: 'Reviewed scope',
    operation_id: randomUUID(),
    expected_revision: '1',
  },
});
test('old runtimes send no unsupported permission or mutation requests', async (t) => {
  const f = await fixture(t);
  f.advertise(false);
  assert.equal((await f.service.status('group')).available, false);
  await assert.rejects(f.service.request('group', decision()), /does not support/);
  assert.deepEqual(f.calls, ['capabilities', 'capabilities']);
});
test('project services read capabilities from the resolved account client and fail closed', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.status('group')).available, true);
  assert.deepEqual(f.calls, ['capabilities', 'project.permissions']);
  const failing = new ProjectServices(f.root, async () => ({
    client: {
      ...f.client,
      request: async (operation: DesktopOperation) => {
        f.calls.push(operation);
        throw Error('desktop.transport_lost');
      },
    } as DesktopClient,
    organizationId: 'org',
    projectId: 'project',
    actorId: 'reviewer',
  }));
  f.calls.length = 0;
  await assert.rejects(failing.status('group'), /transport_lost/);
  await assert.rejects(failing.request('group', decision()), /transport_lost/);
  assert.deepEqual(f.calls, ['capabilities', 'capabilities']);
});
test('reviewer permission is fresh, scoped, and enforced before a mutation', async (t) => {
  const f = await fixture(t);
  f.permissions(false);
  await assert.rejects(f.service.request('group', decision()), /permission/);
  assert.ok(!f.calls.includes('review.decide'));
  f.permissions(true);
  f.scope();
  await assert.rejects(f.service.request('group', decision()), /scope/);
  assert.ok(!f.calls.includes('review.decide'));
});
test('review mutation receipts deduplicate and never replay a lost response', async (t) => {
  const f = await fixture(t),
    request = decision();
  await f.service.request('group', request);
  await f.service.request('group', request);
  assert.equal(f.calls.filter((op) => op === 'review.decide').length, 1);
  await assert.rejects(
    f.service.request('group', { ...request, fields: { ...request.fields, decision: 'deny' } }),
    /different request/,
  );
  f.permissions(false);
  await assert.rejects(f.service.request('group', request), /permission/);
  f.permissions(true);
  f.lose();
  const unknown = decision();
  await assert.rejects(f.service.request('group', unknown), /Transport lost/);
  await assert.rejects(f.service.request('group', unknown), /outcome is unknown/);
  assert.equal(f.calls.filter((op) => op === 'review.decide').length, 2);
  const pending = (await f.service.status('group')).pendingOperations;
  assert.equal(pending?.[0].id, unknown.fields.operation_id);
  f.permissions(false);
  assert.deepEqual((await f.service.status('group')).pendingOperations, []);
});
test('context requires explicit consent and bounded queries', async (t) => {
  const f = await fixture(t);
  const request = {
    operation: 'context.search' as const,
    fields: { query: 'build', limit: 3, max_characters: 1000 },
  };
  await assert.rejects(f.service.request('group', request), /Enable Context/);
  assert.ok(!f.calls.includes('context.search'));
  await assert.rejects(
    f.service.request('group', {
      ...request,
      fields: { ...request.fields, max_characters: 100000 },
    }),
    /bounded/,
  );
  f.consent(true);
  await f.service.request('group', request);
  assert.equal(f.calls.filter((op) => op === 'context.search').length, 1);
});

test('published broker receipts preserve reviewer identity, usage, pagination, and pending delivery', () => {
  const scope = {
    project_scope: { organization_id: 'org', project_id: 'project' },
    actor_id: 'reviewer',
    revision: '1',
    observed_at: '2026-10-21T00:00:00Z',
  };
  const request = decision();
  const receipt = {
    ...scope,
    operation_id: request.fields.operation_id,
    audit_reference: 'audit',
    decision_id: 'decision',
    reviewer_id: 'reviewer',
    request_replayed: false,
  };
  assert.equal(normalizeProjectResult(receipt, request).state, 'completed');
  assert.throws(
    () => normalizeProjectResult({ ...receipt, reviewer_id: 'other' }, request),
    /reviewer receipt/,
  );
  assert.throws(
    () => normalizeProjectResult({ ...receipt, request_replayed: true }, request),
    /reviewer receipt/,
  );
  const inspection = {
    ...scope,
    operation_id: request.fields.operation_id,
    status: 'completed',
    receipt,
  };
  assert.equal(
    normalizeProjectResult(inspection, {
      operation: 'operation.inspect',
      fields: { operation_id: request.fields.operation_id },
    }).receipt_id,
    'audit',
  );
  assert.throws(
    () =>
      normalizeProjectResult(
        { ...inspection, receipt: { ...receipt, actor_id: 'other' } },
        { operation: 'operation.inspect', fields: { operation_id: request.fields.operation_id } },
      ),
    /nested/,
  );
  const row = {
    request_id: 'request',
    usage: { measured_cost: null, input_tokens: '124', settlement_state: 'pending' },
  };
  const history = normalizeProjectResult(
    { ...scope, items: [row], next_cursor: 'next' },
    { operation: 'task.history', fields: { task_id: 'task' } },
  );
  assert.equal(history.cursor, 'next');
  assert.deepEqual(history.items, [row]);
});
test('removed template operations stay unavailable in services and the protocol', async () => {
  const services = new ProjectServices('/unused', async () => {
    throw Error('A removed operation must not resolve a project.');
  });
  for (const operation of ['admin.templates', 'admin.template.save', 'admin.template.apply'])
    await assert.rejects(
      services.request('group', { operation: operation as any, fields: {} }),
      /Invalid project service request/,
    );
  assert.equal(
    Object.keys(projectServicePermissions).some((key) => key.startsWith('admin.')),
    false,
  );
});
