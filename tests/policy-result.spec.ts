import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

const requestId = '0123456789abcdef0123456789abcdef';
const escalationId = `esc_11111111-2222-4333-8444-555555555555_${requestId}`;

/**
 * Each send returns a run that ended with `policy`. `review` is the first `review.inspect`
 * result, or an error code. A decision returns the approved review.
 */
async function chatWith(
  page: Page,
  policy: Record<string, unknown>,
  review?: Record<string, unknown> | string,
) {
  await page.addInitScript(
    ({ policy, review, requestId, escalationId }) => {
      const w = window as any;
      w.policyCalls = { starts: 0, inspects: 0, opens: [], decisions: [] };
      const run = (agent: string) => ({
        id: `run-${w.policyCalls.starts}`,
        agent,
        sessionId: 'saved-1',
        sessionReady: true,
        status: 'completed',
        messages: [{ id: 'm1', role: 'assistant', text: '' }],
        activity: '',
        policy,
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
      w.workspace = {
        snapshot: async () => ({
          projects: [
            { id: 'p1', name: 'web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' },
          ],
          groups: [{ id: 'g1', name: 'Atlas', repoIds: ['p1'] }],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        remoteHosts: async () => [],
        git: async () => null,
        models: async () => [],
        chatCreate: async (_projectId: string, agent: string) => {
          w.policyCalls.starts++;
          return run(agent);
        },
        chatStart: async (agent: string) => {
          w.policyCalls.starts++;
          return run(agent);
        },
        chatStatus: async () => run('codex'),
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
    { policy, review, requestId, escalationId },
  );
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page);
  const composer = page.getByLabel('Message agent');
  await composer.fill('Read the customer table.');
  await composer.press('Enter');
  return page.getByRole('status', { name: 'Policy result' });
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
  await expect(card).toContainText('The policy refused this request');
  await expect(card).toContainText('Customer data is not allowed.');
  await expect(card).toContainText('cfgv_7');
  await expect(card).toContainText(requestId);
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
  await expect(card).toContainText('This request needs a review');
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
