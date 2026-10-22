import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

const requestId = '0123456789abcdef0123456789abcdef';
const escalationId = `esc_11111111-2222-4333-8444-555555555555_${requestId}`;

/**
 * Each send returns a run that ended with `policy`. `review` is the first `review.inspect`
 * result, or an error code. A decision returns the approved review. `saved` is the list of
 * saved policy results of the chat. With `hostId`, the project and the chat are on that SSH host.
 */
async function chatWith(
  page: Page,
  policy: Record<string, unknown>,
  review?: Record<string, unknown> | string,
  options: { saved?: Record<string, unknown>[]; hostId?: string } = {},
) {
  await page.addInitScript(
    ({ policy, review, requestId, escalationId, saved, hostId }) => {
      const w = window as any;
      w.policyCalls = { starts: 0, inspects: 0, opens: [], decisions: [], saved: [], remote: [] };
      const run = (agent: string) => ({
        id: `run-${w.policyCalls.starts}`,
        agent,
        sessionId: 'saved-1',
        sessionReady: true,
        status: 'completed',
        messages: [{ id: 'm1', role: 'assistant', text: '' }],
        activity: '',
        policies: [{ ...policy, at: `2026-10-22T10:0${w.policyCalls.starts}:00.000Z` }],
      });
      const base = {
        escalation_id: escalationId,
        request_id: requestId,
        status: 'pending',
        retryAllowed: false,
        actions: [],
        observedAt: '2026-10-22T10:00:00.000Z',
      };
      let current: any =
        review && typeof review === 'object'
          ? { ...base, ...review, escalationId, requestId }
          : review;
      const start = async (agent: string) => {
        w.policyCalls.starts++;
        return run(agent);
      };
      w.workspace = {
        snapshot: async () => ({
          projects: [
            {
              id: 'p1',
              name: 'web',
              path: hostId ? '/home/dev/web' : '/tmp/web',
              favorite: false,
              notes: '',
              addedAt: '',
              ...(hostId ? { hostId } : {}),
            },
          ],
          groups: [{ id: 'g1', name: 'Atlas', repoIds: ['p1'], ...(hostId ? { hostId } : {}) }],
          hosts: hostId
            ? [{ id: hostId, name: 'devbox', target: 'dev@devbox', status: 'connected' }]
            : [],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        remoteHosts: async () =>
          hostId ? [{ id: hostId, name: 'devbox', target: 'dev@devbox', status: 'connected' }] : [],
        git: async () => null,
        models: async () => [],
        chatCreate: async (_projectId: string, agent: string) => start(agent),
        chatStart: async (agent: string) => start(agent),
        chatStatus: async () => run('codex'),
        remoteCall: async (host: string, method: string, args: any[]) => {
          w.policyCalls.remote.push([host, method]);
          if (method === 'models') return [];
          if (method === 'chatCreate') return start(args[1]);
          if (method === 'chatStart') return start(args[0]);
          if (method === 'chatStatus') return run('codex');
          return null;
        },
        chatPolicyResults: async (agent: string, id: string, host?: string) => {
          w.policyCalls.saved.push([agent, id, host]);
          return saved;
        },
        verdictanReviewInspect: async (id: string, region: string) => {
          w.policyCalls.inspects++;
          if (id !== requestId || region !== 'eu') throw new Error('wrong review');
          if (typeof current === 'string') throw new Error(`Not permitted. [${current}]`);
          return current;
        },
        verdictanReviewOpen: async (id: string, region: string) => {
          w.policyCalls.opens.push([id, region]);
          return current;
        },
        verdictanReviewDecide: async (...args: unknown[]) => {
          w.policyCalls.decisions.push(args);
          current = {
            ...current,
            status: 'approved',
            retryAllowed: true,
            actions: [],
            revision: undefined,
          };
          return current;
        },
      };
    },
    {
      policy,
      review,
      requestId,
      escalationId,
      saved: options.saved || [],
      hostId: options.hostId,
    },
  );
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page);
  const composer = page.getByLabel('Message agent');
  await composer.fill('Read the customer table.');
  await composer.press('Enter');
  return page.getByRole('status', { name: 'Policy result' }).last();
}

const calls = (page: Page) => page.evaluate(() => (window as any).policyCalls);

test('a refusal shows the reason, policy version and request ID, and offers no retry', async ({
  page,
}) => {
  const card = await chatWith(page, {
    decision: 'refused',
    retry: 'denied',
    requestId,
    reason: 'Customer data is not allowed.',
    reasonCode: 'pii',
    policyVersion: 'cfgv_7',
    region: 'eu',
  });
  await expect(card).toContainText('Request refused by policy');
  await expect(card).toContainText('Customer data is not allowed.');
  // The reason code, policy version and request ID are in the "Details" fold.
  await expect(card.getByText('cfgv_7')).toBeHidden();
  await card.getByText('Details', { exact: true }).click();
  await expect(card.getByText('pii', { exact: true })).toBeVisible();
  await expect(card.getByText('cfgv_7')).toBeVisible();
  await expect(card.getByText(requestId)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Send again' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Open review in Console' })).toHaveCount(0);
  expect((await calls(page)).inspects).toBe(0);
});

test('a user without review permission sees no review status, link or actions', async ({
  page,
}) => {
  const card = await chatWith(
    page,
    { decision: 'escalated', retry: 'after_review', requestId, region: 'eu' },
    'desktop.review_forbidden',
  );
  await expect(card).toContainText('Request needs a review');
  await expect(card).toContainText(requestId);
  await expect.poll(async () => (await calls(page)).inspects).toBeGreaterThan(0);
  await expect(card).not.toContainText('Review status');
  await expect(card).not.toContainText(escalationId);
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(card.getByRole('alert')).toHaveCount(0);
});

test('a reviewer approves in the app, then can send the message again', async ({ page }) => {
  const card = await chatWith(
    page,
    { decision: 'escalated', retry: 'after_review', requestId, region: 'eu' },
    { status: 'pending', actions: ['approve', 'deny'], revision: 'rev1' },
  );
  await expect(card).toContainText('Waiting for a reviewer');
  await expect(card).toContainText(escalationId);
  await expect(card.getByRole('button', { name: 'Send again' })).toHaveCount(0);
  const approve = card.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeDisabled();
  await card.getByLabel('Review reason').fill('The table has no personal data.');
  await approve.click();
  await expect(card).toContainText('Approved');
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const decisions = (await calls(page)).decisions;
  expect(decisions).toEqual([
    [requestId, 'eu', 'approve', 'The table has no personal data.', 'rev1'],
  ]);
  expect((await calls(page)).starts).toBe(1);
  await card.getByRole('button', { name: 'Send again' }).click();
  await expect.poll(async () => (await calls(page)).starts).toBe(2);
});

test('a requester sees no review actions', async ({ page }) => {
  const card = await chatWith(
    page,
    { decision: 'escalated', retry: 'after_review', requestId, region: 'eu' },
    { status: 'pending', actions: [], consoleUrl: 'https://console.eu.verdictan.com/inbox' },
  );
  await expect(card).toContainText('Waiting for a reviewer');
  await expect(card.getByRole('button', { name: /Approve|Deny/ })).toHaveCount(0);
  await expect(card.getByLabel('Review reason')).toHaveCount(0);
});

test('the Console link opens the review, and coming back only reads the status', async ({
  page,
}) => {
  const card = await chatWith(
    page,
    { decision: 'escalated', retry: 'after_review', requestId, region: 'eu' },
    {
      status: 'pending',
      consoleUrl: `https://console.eu.verdictan.com/inbox?review=${escalationId}`,
    },
  );
  await card.getByRole('button', { name: 'Open review in Console' }).click();
  await expect.poll(async () => (await calls(page)).opens).toEqual([[requestId, 'eu']]);
  const before = await calls(page);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await calls(page)).inspects).toBeGreaterThan(before.inspects);
  const after = await calls(page);
  expect(after.starts).toBe(1);
  expect(after.decisions).toEqual([]);
  await expect(page.getByLabel('Message agent')).toHaveValue('');
});

test('saved results of earlier runs show, and only the current run offers a retry', async ({
  page,
}) => {
  const earlier = 'f'.repeat(32);
  const card = await chatWith(
    page,
    { decision: 'escalated', retry: 'after_review', requestId, region: 'eu' },
    { status: 'approved', retryAllowed: true },
    {
      saved: [
        {
          decision: 'refused',
          retry: 'denied',
          requestId: earlier,
          reason: 'Customer data is not allowed.',
          policyVersion: 'cfgv_6',
          at: '2026-10-21T09:00:00.000Z',
        },
      ],
    },
  );
  const cards = page.getByRole('status', { name: 'Policy result' });
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Customer data is not allowed.');
  await expect(cards.first()).toContainText(earlier);
  await expect(cards.first().getByRole('button', { name: 'Send again' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Send again' })).toBeVisible();
  // The finished run reads the saved results of the chat again.
  await expect
    .poll(async () => (await calls(page)).saved.some((call: unknown[]) => call[1] === 'saved-1'))
    .toBe(true);
});

test('an SSH chat shows the review status and the Console link, and return only reads', async ({
  page,
}) => {
  const card = await chatWith(
    page,
    { decision: 'escalated', retry: 'after_review', requestId, region: 'eu' },
    {
      status: 'pending',
      consoleUrl: `https://console.eu.verdictan.com/inbox?review=${escalationId}`,
    },
    { hostId: 'h1' },
  );
  await expect(card).toContainText('Waiting for a reviewer');
  await expect(card).toContainText(escalationId);
  expect((await calls(page)).remote).toContainEqual(['h1', 'chatCreate']);
  await card.getByRole('button', { name: 'Open review in Console' }).click();
  await expect.poll(async () => (await calls(page)).opens).toEqual([[requestId, 'eu']]);
  const before = await calls(page);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await calls(page)).inspects).toBeGreaterThan(before.inspects);
  expect((await calls(page)).starts).toBe(1);
  // The saved results of the remote chat use the host of the chat.
  await expect
    .poll(async () => (await calls(page)).saved.some((call: unknown[]) => call[2] === 'h1'))
    .toBe(true);
});
