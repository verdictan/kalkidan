import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagedHistory, type HistorySource } from '../electron/verdictan/managed-history';
import {
  appendHistory,
  historyDecisionLabel,
  historyDetails,
  historyEntries,
  type ManagedHistoryTarget,
} from '../src/domain/managed-history';
import { isOpaqueId } from '../src/domain/verdictan';

const org = '33333333-3333-4333-8333-333333333333';
/** The `history.list_result` item of the Verdictan CLI 0.6.3 contract fixture. */
const item = {
  organization_id: org,
  project_id: 'PVT_project_fixture',
  conversation_id: 'conversation_fixture',
  task_id: 'task_fixture',
  run_id: 'run_fixture',
  turn_id: 'turn_fixture',
  session_id: org,
  runtime_id: '44444444-4444-4444-8444-444444444444',
  agent_kind: 'codex',
  request_id: 'request_fixture',
  decision_outcome: 'allow',
  policy_revision: '1.0.0',
  reason_code: 'allowed',
  review_id: null,
  review_status: null,
  review_decision: null,
  audit_id: 'audit_fixture',
  timestamp: '2026-10-21T09:59:00.000000Z',
  provider: 'openai',
  model: 'gpt-5.4',
  timings: {
    first_event_at: '2026-10-21T09:58:59.000000Z',
    last_event_at: '2026-10-21T09:59:00.000000Z',
    started_at: '2026-10-21T09:58:59.100000Z',
    completed_at: '2026-10-21T09:59:00.000000Z',
    latency_ms: '900',
  },
  usage: {
    currency: 'USD',
    measured_cost: '0.01250000',
    input_tokens: '100',
    output_tokens: '20',
    cached_input_tokens: null,
    total_tokens: '120',
    settlement_state: 'completed',
    source: 'usage_authorization_ledger',
    authorization_id: '55555555-5555-4555-8555-555555555555',
    attempt_id: null,
    usage_audit_id: null,
    provider_charge: 'not_reported',
  },
  settlement: {
    state: 'completed',
    released_at: '2026-10-21T09:59:30.000000Z',
    settled_at: '2026-10-21T10:00:00.000000Z',
    corrected: true,
  },
  revision: '0f5a3c8d2e1b4a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
  observed_at: '2026-10-21T10:00:00.000000Z',
};

test('history entries keep decisions, tokens, timings and corrections, and remove every ID', () => {
  const [entry] = historyEntries([item]);
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.model, 'gpt-5.4');
  assert.equal(entry.totalTokens, '120');
  assert.equal(entry.cachedInputTokens, null);
  assert.equal(entry.cost, '0.01250000');
  assert.equal(entry.currency, 'USD');
  assert.equal(entry.corrected, true);
  assert.equal(entry.latencyMs, '900');
  assert.equal(entry.audited, true);
  assert.deepEqual(historyDecisionLabel(entry), { label: 'Allowed', tone: 'success' });
  const visible = JSON.stringify([entry, historyDetails(entry)]);
  for (const value of [
    org,
    item.runtime_id,
    item.usage.authorization_id,
    item.revision,
    'request_fixture',
    'audit_fixture',
    'PVT_project_fixture',
    'conversation_fixture',
    'run_fixture',
  ])
    assert.equal(visible.includes(value), false, value);
  const details = Object.fromEntries(historyDetails(entry));
  assert.match(details.Settlement, /Completed · Corrected after release/);
  assert.equal(details.Cost, '0.01250000 USD');
  assert.match(details.Tokens, /120 in total · 100 in · 20 out · unknown cached/);
  assert.equal(details['Audit record'], 'Recorded');
  for (const value of Object.values(details)) assert.equal(isOpaqueId(value), false);
});

test('unknown history values stay unknown and never become zero', () => {
  const [entry] = historyEntries([
    {
      organization_id: org,
      decision_outcome: 'deny',
      model: 'cfg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      usage: {
        currency: null,
        measured_cost: null,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        settlement_state: 'released',
      },
      settlement: { state: 'released', released_at: null, settled_at: null, corrected: false },
      timings: {},
    },
  ]);
  assert.equal(entry.totalTokens, null);
  assert.equal(entry.cost, null);
  // An ID in a name field never shows.
  assert.equal(entry.model, null);
  const details = Object.fromEntries(historyDetails(entry));
  assert.equal(details.Cost, 'Unknown');
  assert.equal(details.Model, 'Unknown');
  assert.equal(details.Duration, 'Unknown');
  assert.equal(details['Audit record'], 'Unknown');
  assert.doesNotMatch(details.Tokens, /\b0\b/);
  assert.deepEqual(historyDecisionLabel(entry), { label: 'Denied', tone: 'destructive' });
  // A cost without a currency is not known.
  assert.equal(historyEntries([{ usage: { measured_cost: '1.5', currency: null } }])[0].cost, null);
  assert.deepEqual(historyEntries('not a list'), []);
});

function fixture(
  options: {
    capabilities?: string[];
    data?: (request: any) => Record<string, unknown>;
    keys?: HistorySource['keys'];
  } = {},
) {
  const requests: { operation: string; parameters: any }[] = [];
  const legacy: any[] = [];
  let actor = org;
  const client = {
    request: async (operation: string, parameters: any = {}) => {
      requests.push({ operation, parameters });
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.6.3',
            protocol_min: 1,
            protocol_max: 1,
            capabilities: options.capabilities ?? ['history.list', 'task.history'],
            managed_execution_ready: true,
            tested_agents: [],
          },
        };
      return {
        data: options.data?.(parameters) ?? {
          history_scope: parameters.history_scope,
          actor_id: org,
          observed_at: '2026-10-21T10:00:00.000000Z',
          as_of: '2026-10-21T10:00:00.000000Z',
          items: [item],
          next_cursor: parameters.cursor ? null : 'page-2',
          ordering: 'first_observed_ascending',
          consistency: 'current_ledger',
          absence_means: 'unknown_or_not_ingested',
          correction_refresh: 'restart_without_cursor',
          replay_executes_requests: false,
        },
      };
    },
  };
  const history = new ManagedHistory(
    async (target) => ({
      client: client as any,
      accountKey: 'account',
      organizationId: org,
      actorId: actor,
      keys:
        options.keys ??
        (target.kind === 'task'
          ? { project_id: 'PVT_project_fixture', task_id: 'task_fixture' }
          : { conversation_id: 'conversation_fixture' }),
    }),
    async (groupId, fields) => {
      legacy.push({ groupId, fields });
      return {
        project_scope: { organization_id: org, project_id: 'PVT_project_fixture' },
        actor_id: org,
        revision: '1',
        observed_at: '2026-10-21T10:00:00Z',
        items: [item],
        next_cursor: null,
      };
    },
  );
  return {
    history,
    requests,
    legacy,
    changeActor: () => {
      actor = 'someone-else';
    },
  };
}
const chat: ManagedHistoryTarget = { kind: 'conversation', agent: 'codex', sessionId: 'chat' };
const task: ManagedHistoryTarget = { kind: 'task', groupId: 'group', taskId: 'task_fixture' };

test('chat history uses history.list with the conversation key and no project scope', async () => {
  const f = fixture();
  const page = await f.history.list(chat);
  const sent = f.requests.find((request) => request.operation === 'history.list')!;
  assert.deepEqual(sent.parameters, {
    history_scope: { organization_id: org, conversation_id: 'conversation_fixture' },
    limit: 25,
  });
  assert.equal(page.source, 'history');
  assert.equal(page.cursor, 'page-2');
  assert.equal(page.entries.length, 1);
  // The next page sends the cursor. "Load again" sends no cursor, so corrections show.
  const next = await f.history.list({ ...chat, cursor: 'page-2' });
  assert.equal(f.requests.at(-1)!.parameters.cursor, 'page-2');
  assert.equal(next.cursor, null);
  assert.equal(appendHistory(page, next).entries.length, 2);
  assert.equal(appendHistory(page, next).asOf, page.asOf);
  await f.history.list(chat);
  assert.equal('cursor' in f.requests.at(-1)!.parameters, false);
});

test('task history sends the project and task keys', async () => {
  const f = fixture();
  await f.history.list(task);
  assert.deepEqual(f.requests.find((r) => r.operation === 'history.list')!.parameters, {
    history_scope: {
      organization_id: org,
      project_id: 'PVT_project_fixture',
      task_id: 'task_fixture',
    },
    limit: 25,
  });
  assert.equal(f.legacy.length, 0);
});

test('without history.list, a task uses task.history for one release and a chat has none', async () => {
  const f = fixture({ capabilities: ['task.history'] });
  const page = await f.history.list({ ...task, cursor: 'older' });
  assert.deepEqual(f.legacy, [
    { groupId: 'group', fields: { task_id: 'task_fixture', cursor: 'older' } },
  ]);
  assert.equal(page.source, 'task-history');
  assert.equal(page.entries[0].corrected, true);
  await assert.rejects(f.history.list(chat), /operation_unsupported/);
  assert.equal(
    f.requests.some((request) => request.operation === 'history.list'),
    false,
  );
  const none = fixture({ capabilities: [] });
  await assert.rejects(none.history.list(task), /operation_unsupported/);
});

test('a history response for another actor, scope or request is rejected', async () => {
  const valid = (request: any) => ({
    history_scope: request.history_scope,
    actor_id: org,
    observed_at: '2026-10-21T10:00:00Z',
    as_of: '2026-10-21T10:00:00Z',
    items: [item],
    next_cursor: null,
    replay_executes_requests: false,
  });
  for (const change of [
    (r: any) => ({ ...valid(r), actor_id: 'other' }),
    (r: any) => ({ ...valid(r), history_scope: { ...r.history_scope, conversation_id: 'x' } }),
    (r: any) => ({ ...valid(r), history_scope: { ...r.history_scope, task_id: 'x' } }),
    (r: any) => ({ ...valid(r), items: [{ ...item, conversation_id: 'another_chat' }] }),
    (r: any) => ({ ...valid(r), items: [{ ...item, organization_id: 'other' }] }),
    (r: any) => ({ ...valid(r), items: Array(26).fill(item) }),
    (r: any) => ({ ...valid(r), replay_executes_requests: true }),
    (r: any) => ({ ...valid(r), observed_at: 'yesterday' }),
    (r: any) => ({ ...valid(r), next_cursor: 'bad cursor' }),
  ]) {
    const f = fixture({ data: change });
    await assert.rejects(f.history.list(chat), /history_invalid/);
  }
});

test('history input and scope keys are checked, and an account change hides the result', async () => {
  const f = fixture();
  for (const target of [
    { kind: 'other' },
    { ...chat, sessionId: '' },
    { ...task, taskId: 'x'.repeat(600) },
    { ...chat, cursor: 'has space' },
  ])
    await assert.rejects(f.history.list(target as any), /invalid_request/);
  const bad = fixture({ keys: { conversation_id: 'not valid!' } });
  await assert.rejects(bad.history.list(chat), /invalid_correlation/);
  const empty = fixture({ keys: {} });
  await assert.rejects(empty.history.list(chat), /invalid_request/);
  const moving = fixture({
    data: (request) => {
      moving.changeActor();
      return {
        history_scope: request.history_scope,
        actor_id: org,
        observed_at: '2026-10-21T10:00:00Z',
        items: [],
        next_cursor: null,
        replay_executes_requests: false,
      };
    },
  });
  await assert.rejects(moving.history.list(chat), /identity_mismatch/);
});
