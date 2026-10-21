import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectUsageReader, type ProjectUsageSource } from '../electron/verdictan/project-usage';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import type { ManagedHistoryEntry, ManagedHistoryTarget } from '../src/domain/managed-history';
import {
  addDecimal,
  localDay,
  projectUsageLimits,
  summarizeProjectUsage,
  usageCostText,
  usageDecision,
  type ProjectUsage,
} from '../src/domain/project-usage';

function entry(values: Partial<ManagedHistoryEntry> = {}): ManagedHistoryEntry {
  return {
    time: '2026-10-21T12:00:00.000Z',
    decision: 'allow',
    reason: 'allowed',
    review: null,
    provider: 'openai',
    model: 'gpt-5.4',
    agent: 'codex',
    inputTokens: '100',
    outputTokens: '20',
    cachedInputTokens: '10',
    totalTokens: '120',
    cost: '0.0125',
    currency: 'USD',
    settlement: 'completed',
    corrected: false,
    releasedAt: null,
    settledAt: null,
    startedAt: null,
    completedAt: null,
    latencyMs: null,
    audited: true,
    subscription: null,
    ...values,
  };
}
const now = Date.parse('2026-10-21T12:00:00.000Z');

test('decimal amounts add up without rounding', () => {
  assert.equal(addDecimal('0', '0.0125'), '0.0125');
  assert.equal(addDecimal('0.1', '0.2'), '0.3');
  assert.equal(addDecimal('1.50', '2.5'), '4');
  assert.equal(addDecimal('0.00000001', '12'), '12.00000001');
  assert.equal(addDecimal('-1.5', '0.25'), '-1.25');
  assert.equal(addDecimal('99999999999999999999', '1'), '100000000000000000000');
});

test('the decision of a request is allowed, refused or other', () => {
  assert.equal(usageDecision(entry()), 'allowed');
  assert.equal(usageDecision(entry({ decision: 'deny' })), 'refused');
  assert.equal(usageDecision(entry({ decision: 'blocked' })), 'refused');
  assert.equal(usageDecision(entry({ decision: 'escalate' })), 'other');
  assert.equal(usageDecision(entry({ decision: null })), 'other');
});

test('the summary adds requests, decisions, tokens, models, chats and days', () => {
  const usage: ProjectUsage = {
    observedAt: '2026-10-21T12:00:00.000Z',
    unmanaged: 1,
    failed: 0,
    skipped: 0,
    chats: [
      {
        agent: 'codex',
        sessionId: 'metered',
        billing: 'metered',
        complete: true,
        entries: [
          entry(),
          entry({ decision: 'deny', cost: null, currency: null, outputTokens: null }),
          entry({ time: '2026-10-19T12:00:00.000Z', model: 'gpt-5.4-mini', cost: '0.5' }),
          entry({ time: null, cost: '1', currency: 'EUR' }),
          entry({ time: '2026-09-01T12:00:00.000Z' }),
        ],
      },
      {
        agent: 'claude',
        sessionId: 'subscription',
        billing: 'subscription',
        complete: false,
        entries: [entry({ model: 'claude-opus', cost: '9.99', agent: 'claude_code' })],
      },
      { agent: 'codex', sessionId: 'empty', billing: 'metered', complete: true, entries: [] },
    ],
  };
  const summary = summarizeProjectUsage(usage, now, 7);
  assert.equal(summary.requests, 6);
  assert.equal(summary.allowed, 5);
  assert.equal(summary.refused, 1);
  assert.equal(summary.other, 0);
  assert.deepEqual(summary.tokens, { input: 600, output: 100, cached: 60, unknown: 1 });
  // The subscription request has a cost in the history, but a subscription has no charge.
  assert.deepEqual(summary.cost, { USD: '0.525', EUR: '1' });
  assert.equal(summary.costUnknown, 1);
  assert.equal(summary.subscription, 1);
  assert.deepEqual(summary.models, [
    { name: 'gpt-5.4', requests: 4 },
    { name: 'claude-opus', requests: 1 },
    { name: 'gpt-5.4-mini', requests: 1 },
  ]);
  assert.deepEqual(
    summary.chats.map((chat) => [chat.sessionId, chat.requests, chat.refused, chat.billing]),
    [
      ['metered', 5, 1, 'metered'],
      ['subscription', 1, 0, 'subscription'],
    ],
  );
  assert.equal(summary.chats[0].lastTime, '2026-10-21T12:00:00.000Z');
  assert.deepEqual(summary.chats[0].models, ['gpt-5.4', 'gpt-5.4-mini']);
  assert.equal(summary.days.length, 7);
  assert.equal(summary.days.at(-1)!.date, localDay(now));
  assert.equal(summary.days.at(-1)!.requests, 3);
  assert.equal(
    summary.days.find((day) => day.date === localDay(Date.parse('2026-10-19T12:00:00Z')))!.requests,
    1,
  );
  assert.equal(
    summary.days.reduce((sum, day) => sum + day.requests, 0),
    4,
  );
  assert.equal(summary.undated, 1);
  assert.equal(summary.partial, true);
  assert.equal(
    usageCostText(summary),
    '1 EUR · 0.525 USD · 1 included in your subscription · 1 unknown',
  );
  assert.equal(usageCostText(summary.chats[1]), 'Included in your subscription');
  assert.equal(
    usageCostText({ cost: {}, costUnknown: 2, subscription: 0, requests: 2 }),
    'Unknown',
  );
  assert.equal(usageCostText({ cost: {}, costUnknown: 0, subscription: 0, requests: 0 }), 'None');
});

test('an empty history has zero requests and a full row of days', () => {
  const summary = summarizeProjectUsage(
    { chats: [], unmanaged: 0, failed: 0, skipped: 0, observedAt: '2026-10-21T12:00:00Z' },
    now,
  );
  assert.equal(summary.requests, 0);
  assert.equal(summary.days.length, 14);
  assert.equal(summary.partial, false);
  assert.ok(summary.days.every((day) => day.requests === 0));
});

function reader(overrides: Partial<ProjectUsageSource> = {}) {
  const calls: ManagedHistoryTarget[] = [];
  const source: ProjectUsageSource = {
    now: () => '2026-10-21T12:00:00.000Z',
    history: async (target) => {
      calls.push(target);
      if (target.kind !== 'conversation') throw Error('wrong scope');
      if (target.sessionId === 'broken') throw new DesktopProtocolError('desktop.history_invalid');
      if (target.sessionId === 'long')
        return {
          entries: [entry()],
          cursor: `page-${calls.length}`,
          asOf: null,
          observedAt: '2026-10-21T12:00:00.000Z',
        };
      return {
        entries: target.cursor ? [entry({ decision: 'deny' })] : [entry()],
        cursor: target.cursor ? null : 'next',
        asOf: null,
        observedAt: '2026-10-21T12:00:00.000Z',
      };
    },
    binding: async (agent, sessionId) =>
      sessionId === 'unbound'
        ? null
        : {
            billing: agent === 'claude' ? 'subscription' : 'metered',
            cwd: sessionId === 'outside' ? '/elsewhere' : '/repo/sub',
          },
    inProject: async (groupId, cwd) => groupId === 'g' && cwd.startsWith('/repo'),
    ...overrides,
  };
  return { usage: new ProjectUsageReader(source), calls };
}

test('the reader reads every page of each project chat and skips other chats', async () => {
  const { usage, calls } = reader();
  const result = await usage.read('g', [
    { agent: 'codex', sessionId: 'one' },
    { agent: 'claude', sessionId: 'two' },
    { agent: 'codex', sessionId: 'one' },
    { agent: 'codex', sessionId: 'unbound' },
    { agent: 'codex', sessionId: 'outside' },
  ]);
  assert.deepEqual(
    result.chats.map((chat) => [chat.sessionId, chat.billing, chat.entries.length, chat.complete]),
    [
      ['one', 'metered', 2, true],
      ['two', 'subscription', 2, true],
    ],
  );
  assert.equal(result.unmanaged, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(calls[1], {
    kind: 'conversation',
    agent: 'codex',
    sessionId: 'one',
    cursor: 'next',
  });
});

test('the reader stops at the page limit and marks the chat as incomplete', async () => {
  const { usage, calls } = reader();
  const result = await usage.read('g', [{ agent: 'codex', sessionId: 'long' }]);
  assert.equal(calls.length, projectUsageLimits.pages);
  assert.equal(result.chats[0].entries.length, projectUsageLimits.pages);
  assert.equal(result.chats[0].complete, false);
});

test('the reader reads only the most recent chats', async () => {
  const { usage } = reader();
  const chats = Array.from({ length: projectUsageLimits.chats + 5 }, (_, index) => ({
    agent: 'codex',
    sessionId: `chat-${index}`,
  }));
  const result = await usage.read('g', chats);
  assert.equal(result.chats.length, projectUsageLimits.chats);
  assert.equal(result.skipped, 5);
});

test('one failed chat is counted, but the history is unavailable when all chats fail', async () => {
  const { usage } = reader();
  const result = await usage.read('g', [
    { agent: 'codex', sessionId: 'broken' },
    { agent: 'codex', sessionId: 'one' },
  ]);
  assert.equal(result.failed, 1);
  assert.equal(result.chats.length, 1);
  await assert.rejects(
    usage.read('g', [{ agent: 'codex', sessionId: 'broken' }]),
    (error: any) => error.code === 'desktop.history_invalid',
  );
  // No managed chat is not an error.
  assert.deepEqual((await usage.read('g', [{ agent: 'codex', sessionId: 'unbound' }])).chats, []);
  // An account that is not ready stops the read.
  const notReady = reader({
    binding: async () => {
      throw new DesktopProtocolError('desktop.runtime_starting');
    },
  });
  await assert.rejects(
    notReady.usage.read('g', [{ agent: 'codex', sessionId: 'one' }]),
    (error: any) => error.code === 'desktop.runtime_starting',
  );
});

test('the reader rejects a request that is not valid', async () => {
  const { usage, calls } = reader();
  for (const [groupId, chats] of [
    ['', []],
    ['g', null],
    ['g', [{ agent: 'gemini', sessionId: 'x' }]],
    ['g', [{ agent: 'codex', sessionId: '' }]],
    ['g', [{ agent: 'codex', sessionId: 'x'.repeat(513) }]],
    ['g', Array.from({ length: 1001 }, () => ({ agent: 'codex', sessionId: 'x' }))],
  ] as const)
    await assert.rejects(
      usage.read(groupId, chats as never),
      (error: any) => error.code === 'desktop.invalid_request',
    );
  assert.equal(calls.length, 0);
});
