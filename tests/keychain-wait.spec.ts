import { type Page } from '@playwright/test';
import { test, expect, newChat, openComputersPage } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

const waitingText =
  'Waiting for Keychain access on this computer. Allow access in the macOS dialog.';

/**
 * A signed-in desktop. The first send waits for a Keychain prompt until `window.allow()` runs.
 * The account status tells the UI about the wait, as the desktop does.
 */
async function installWorkspace(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    const listeners = new Set<() => void>();
    w.waiting = false;
    w.allow = () => undefined;
    const changed = () => listeners.forEach((listener) => listener());
    w.wait = () => {
      w.waiting = true;
      changed();
    };
    const answered = (agent: string) => ({
      id: 'answered',
      agent,
      sessionId: 'provider-session',
      sessionReady: true,
      status: 'completed',
      activity: '',
      messages: [{ id: 'answer', role: 'assistant', text: 'OK.' }],
    });
    async function start(agent: string) {
      w.wait();
      await new Promise((resolve) => (w.allow = resolve));
      w.waiting = false;
      changed();
      return answered(agent);
    }
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
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      agentInstallations: async () => [],
      git: async () => null,
      onVerdictanChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'authenticated',
        account: {
          state: 'authenticated',
          userId: 'user',
          organizationId: 'org',
          apiUrl: 'https://api.eu.verdictan.com',
        },
        executionReady: true,
        ...(w.waiting ? { keychainWaiting: true } : {}),
      }),
      runtimeUpdateStatus: async () => ({
        hostId: 'local',
        component: 'verdictan',
        discovery: 'current',
        stale: false,
        history: [],
        installed: { version: '0.6.13' },
      }),
      chatCreate: async (_projectId: string, agent: string) => start(agent),
      chatStart: async (agent: string) => start(agent),
      chatStatus: async () => answered('codex'),
    };
  });
}

test('the chat asks for Keychain access while a start waits for the macOS prompt', async ({
  page,
}) => {
  await installWorkspace(page);
  await page.goto('/');
  await openCodeFolder(page);
  await newChat(page, 'codex');
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  await expect(page.locator('.chat-activity').getByRole('status')).toHaveText(waitingText);
  await page.evaluate(() => (window as any).allow());
  await expect(page.getByText('OK.', { exact: true })).toBeVisible();
  await expect(page.getByText(waitingText)).toHaveCount(0);
});

test('Computers asks for Keychain access on this computer while a request waits', async ({
  page,
}) => {
  await installWorkspace(page);
  await page.goto('/');
  const computers = await openComputersPage(page);
  const row = computers.getByRole('group', { name: 'Managed agents', exact: true });
  await expect(row).not.toContainText(waitingText);
  await page.evaluate(() => (window as any).wait());
  await expect(row.getByTestId('keychain-waiting')).toHaveText(waitingText);
});
