import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectUsageReader,
  chatHost,
  usageCacheMs,
  usageConcurrency,
  type ProjectUsageSource,
} from '../electron/verdictan/project-usage';
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
    account: async () => ({ key: 'account-1', organizationId: 'o1', userId: 'u1' }),
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
  // The chats load at the same time, so the calls of two chats can alternate.
  const pages = calls.filter((call) => call.kind === 'conversation' && call.sessionId === 'one');
  assert.deepEqual(pages[1], {
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
  const signedOut = reader({
    account: async () => {
      throw new DesktopProtocolError('desktop.auth_required');
    },
  });
  await assert.rejects(
    signedOut.usage.read('g', [{ agent: 'codex', sessionId: 'one' }]),
    (error: any) => error.code === 'desktop.auth_required',
  );
  assert.equal(signedOut.calls.length, 0);
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
  for (const options of [null, 'fresh'])
    await assert.rejects(
      usage.read('g', [], options as never),
      (error: any) => error.code === 'desktop.invalid_request',
    );
  assert.equal(calls.length, 0);
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * A source with a fixed latency for each call: 150 ms for the account check and 200 ms for
 * each history page. Each chat has 2 pages. `active` records the most history calls that ran
 * at the same time.
 */
function slowReader(clock = () => Date.now()) {
  let active = 0;
  const stats = { history: 0, account: 0, peak: 0 };
  const source: ProjectUsageSource = {
    now: () => '2026-10-21T12:00:00.000Z',
    clock,
    account: async () => {
      stats.account++;
      await sleep(150);
      return { key: 'account-1', organizationId: 'o1', userId: 'u1' };
    },
    history: async (target) => {
      stats.history++;
      stats.peak = Math.max(stats.peak, ++active);
      await sleep(200);
      active--;
      return {
        entries: [entry()],
        cursor: target.cursor ? null : 'next',
        asOf: null,
        observedAt: '2026-10-21T12:00:00.000Z',
      };
    },
    binding: async () => ({ billing: 'metered', cwd: '/repo' }),
    inProject: async () => true,
  };
  return { usage: new ProjectUsageReader(source), stats };
}

test('the reader reads chats at the same time and keeps their order', async () => {
  const { usage, stats } = slowReader();
  const chats = ['a', 'b', 'c', 'd'].map((id) => ({ agent: 'codex' as const, sessionId: id }));
  const started = performance.now();
  const result = await usage.read('g', chats);
  const elapsed = performance.now() - started;
  // One at a time, with one account check for each chat as before, this takes about
  // 4 x (150 + 2 x 200) = 2,200 ms. Now it is about 150 + 2 x 200 = 550 ms.
  console.log(`project usage, 4 chats x 2 pages: ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
  assert.equal(stats.peak, usageConcurrency);
  assert.equal(stats.account, 1);
  assert.deepEqual(
    result.chats.map((chat) => chat.sessionId),
    ['a', 'b', 'c', 'd'],
  );
  assert.ok(result.chats.every((chat) => chat.entries.length === 2 && chat.complete));
});

test('the reader reads no more than the concurrency limit at the same time', async () => {
  const { usage, stats } = slowReader();
  const chats = Array.from({ length: 10 }, (_, index) => ({
    agent: 'codex' as const,
    sessionId: `chat-${index}`,
  }));
  const result = await usage.read('g', chats);
  assert.equal(stats.peak, usageConcurrency);
  assert.equal(result.chats.length, 10);
});

test('the reader keeps each chat for a short time, and fresh reads it again', async () => {
  let time = 1_000_000;
  const { usage, stats } = slowReader(() => time);
  const chats = ['a', 'b'].map((id) => ({ agent: 'codex' as const, sessionId: id }));
  await usage.read('g', chats);
  assert.equal(stats.history, 4);
  const started = performance.now();
  const cached = await usage.read('g', chats);
  const elapsed = performance.now() - started;
  console.log(`project usage from the cache: ${Math.round(elapsed)} ms`);
  // Only the account check runs.
  assert.equal(stats.history, 4);
  assert.equal(stats.account, 2);
  assert.equal(cached.chats.length, 2);
  // The result is a copy. A change does not change the cache.
  cached.chats[0].entries.length = 0;
  assert.equal((await usage.read('g', chats)).chats[0].entries.length, 2);
  // Another project does not use the cache of this project.
  await usage.read('other', chats);
  assert.equal(stats.history, 8);
  await usage.read('g', chats, { fresh: true });
  assert.equal(stats.history, 12);
  time += usageCacheMs;
  await usage.read('g', chats);
  assert.equal(stats.history, 16);
});

test('the cache is for one account, and a failed chat does not go into it', async () => {
  let key = 'account-1';
  let broken = true;
  const calls: string[] = [];
  const usage = new ProjectUsageReader({
    now: () => '2026-10-21T12:00:00.000Z',
    account: async () => ({ key, organizationId: 'o1', userId: 'u1' }),
    history: async (target) => {
      if (target.kind !== 'conversation') throw Error('wrong scope');
      calls.push(target.sessionId);
      if (target.sessionId === 'b' && broken)
        throw new DesktopProtocolError('desktop.history_invalid');
      return { entries: [entry()], cursor: null, asOf: null, observedAt: '2026-10-21T12:00:00Z' };
    },
    binding: async () => ({ billing: 'metered', cwd: '/repo' }),
    inProject: async () => true,
  });
  const chats = ['a', 'b'].map((id) => ({ agent: 'codex' as const, sessionId: id }));
  assert.equal((await usage.read('g', chats)).failed, 1);
  broken = false;
  const second = await usage.read('g', chats);
  assert.equal(second.failed, 0);
  assert.deepEqual(calls, ['a', 'b', 'b']);
  // A different account reads each chat again.
  key = 'account-2';
  await usage.read('g', chats);
  assert.deepEqual(calls, ['a', 'b', 'b', 'a', 'b']);
  // An account without a key does not use the cache.
  key = '';
  await usage.read('g', chats);
  await usage.read('g', chats);
  assert.equal(calls.length, 9);
});

test('an error from a binding stops the other chats', async () => {
  let bindings = 0;
  const usage = new ProjectUsageReader({
    account: async () => ({ key: 'k', organizationId: 'o1', userId: 'u1' }),
    history: async () => ({ entries: [], cursor: null, asOf: null, observedAt: '2026-10-21Z' }),
    binding: async () => {
      bindings++;
      await sleep(5);
      throw new DesktopProtocolError('desktop.runtime_starting');
    },
    inProject: async () => true,
  });
  const chats = Array.from({ length: 20 }, (_, index) => ({
    agent: 'codex' as const,
    sessionId: `chat-${index}`,
  }));
  await assert.rejects(
    usage.read('g', chats),
    (error: any) => error.code === 'desktop.runtime_starting',
  );
  await sleep(30);
  assert.equal(bindings, usageConcurrency);
});

test('a usage error offers only an action that can fix it', async () => {
  const { usageErrorAction } = await import('../src/components/project-usage');
  assert.deepEqual(usageErrorAction('Managed-agent history requires the desktop app.'), {
    kind: 'none',
  });
  assert.deepEqual(usageErrorAction('Something failed.'), { kind: 'retry' });
  assert.deepEqual(usageErrorAction('Sign in. [desktop.auth_expired]'), { kind: 'sign-in' });
  assert.deepEqual(usageErrorAction('Stopped. [desktop.browser_failed]'), { kind: 'retry' });
  assert.equal(usageErrorAction('Missing. [desktop.runtime_missing]').kind, 'settings');
});

test('the reader counts chats on SSH hosts, labels each chat and counts a conversation once', async () => {
  const projects: [string, string, string | undefined][] = [];
  const { usage, calls } = reader({
    binding: async (_agent, sessionId) =>
      sessionId === 'h1::unbound'
        ? null
        : {
            billing: 'metered',
            cwd: sessionId.startsWith('h1::') ? '/srv/app' : '/repo',
            // A chat with the same conversation as an earlier chat counts once.
            conversationId: ['a', 'h1::copy'].includes(sessionId)
              ? 'conversation-a'
              : `conversation-${sessionId}`,
          },
    inProject: async (groupId, cwd, hostId) => {
      projects.push([groupId, cwd, hostId]);
      return hostId === 'h1' ? cwd === '/srv/app' : cwd === '/repo';
    },
    hostName: (hostId) => (hostId === 'h1' ? 'Build server' : undefined),
  });
  const result = await usage.read('g', [
    { agent: 'codex', sessionId: 'a' },
    { agent: 'codex', sessionId: 'h1::remote' },
    { agent: 'codex', sessionId: 'h1::copy' },
    { agent: 'codex', sessionId: 'h1::unbound' },
    { agent: 'claude', sessionId: 'h2::other' },
  ]);
  assert.deepEqual(
    result.chats.map((chat) => [chat.sessionId, chat.hostId, chat.hostName]),
    [
      ['a', undefined, undefined],
      ['h1::remote', 'h1', 'Build server'],
      // A host without a known name has no name. The page shows a general label.
      ['h2::other', 'h2', undefined],
    ],
  );
  assert.equal(result.unmanaged, 1);
  // The project check gets the host of the chat.
  assert.deepEqual(
    projects.find(([, , host]) => host === 'h1'),
    ['g', '/srv/app', 'h1'],
  );
  assert.deepEqual(
    projects.find(([, , host]) => !host),
    ['g', '/repo', undefined],
  );
  // The conversation of the copy is read, but its requests do not count again.
  assert.ok(calls.some((call) => call.kind === 'conversation' && call.sessionId === 'h1::copy'));
  const summary = summarizeProjectUsage(result, now);
  assert.deepEqual(
    summary.chats.map((chat) => chat.host),
    ['This computer', 'Build server', 'SSH host'],
  );
  assert.equal(summary.requests, 6);
  // A cached read keeps the same result.
  const again = await usage.read('g', [
    { agent: 'codex', sessionId: 'a' },
    { agent: 'codex', sessionId: 'h1::copy' },
  ]);
  assert.deepEqual(
    again.chats.map((chat) => chat.sessionId),
    ['a'],
  );
});

test('the host of a session ID is the part before the separator', () => {
  assert.equal(chatHost('h1::abc'), 'h1');
  assert.equal(chatHost('abc'), undefined);
  assert.equal(chatHost('::abc'), undefined);
});
