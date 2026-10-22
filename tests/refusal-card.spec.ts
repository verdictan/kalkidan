import { type Page } from '@playwright/test';
import { test, expect, newChat } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

const notice =
  'Kalkidan runs agents only through managed Verdictan agents. It does not start a local agent CLI directly.';

/** Each send is refused with `code`. The desktop text is the older generic text. */
async function refuseWith(page: Page, code: string, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ code, notice, extra }) => {
      const w = window as any;
      const refused = (agent: string) => ({
        id: 'refused',
        agent,
        sessionId: '',
        status: 'failed',
        messages: [],
        activity: '',
        errorCode: 'managed_launch_blocked',
        error: `${notice} The managed agents check did not pass. Check the status, then send the message again.`,
        managedSetup: 'runtime',
        managedCode: code,
        ...extra,
      });
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
        chatCreate: async (_projectId: string, agent: string) => refused(agent),
        chatStart: async (agent: string) => refused(agent),
        chatStatus: async () => refused('codex'),
      };
    },
    { code, notice, extra },
  );
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page);
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  return page.locator('.chat-message.user .chat-send-failure');
}

test('a gateway readiness refusal names the computer and offers no runtime install', async ({
  page,
}) => {
  const card = await refuseWith(page, 'desktop.readiness_blocked');
  await expect(card).toContainText(
    'The managed gateway on this computer is not ready. Try again in a moment.',
  );
  await expect(card.getByRole('button', { name: 'Install managed runtime' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Use another agent', exact: true })).toBeVisible();
  // The policy sentence is in the "Details" fold, not the first words.
  const text = (await card.innerText()).trim();
  expect(text.startsWith('Kalkidan runs agents only')).toBe(false);
  await expect(card.getByText(notice)).toBeHidden();
  await card.getByText('Details', { exact: true }).click();
  await expect(card.getByText(notice)).toBeVisible();
});

test('a transient Verdictan refusal shows only the retry actions', async ({ page }) => {
  const card = await refuseWith(page, 'desktop.event_authority_unavailable');
  await expect(card).toContainText('The Verdictan service did not answer in time. Try again.');
  await expect(card.getByRole('button', { name: /Install|Open|Check|Set up/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
});

test('a missing runtime still offers the runtime install', async ({ page }) => {
  const card = await refuseWith(page, 'desktop.runtime_missing');
  await expect(card.getByRole('button', { name: 'Install managed runtime' })).toBeVisible();
});

test('an old agent names the version that the launch found', async ({ page }) => {
  const card = await refuseWith(page, 'desktop.codex_version_unsupported', {
    agentVersion: '0.150.0',
    managedSetup: 'agents',
  });
  await expect(card).toContainText('This computer has Codex 0.150.0.');
  await expect(card.getByRole('button', { name: 'Choose the Codex program' })).toBeVisible();
});
