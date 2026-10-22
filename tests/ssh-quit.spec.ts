import { type Page } from '@playwright/test';
import { test, expect, openPreferences } from './helpers/app';

/** A signed-in desktop. `ask` sends the quit question from the main process. */
async function fixture(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.answers = [];
    w.asks = true;
    w.workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      onMenuCommand: () => () => {},
      dataNoticeState: async () => ({ seen: true }),
      verdictanStatus: async () => ({
        region: 'eu',
        phase: 'authenticated',
        executionReady: true,
        account: {
          state: 'authenticated',
          userId: 'u1',
          organizationId: 'o1',
          organizationName: 'Acme Corp',
          apiUrl: 'https://api.eu.verdictan.com',
          expiresAt: '2026-11-01T00:00:00Z',
        },
      }),
      onSshQuitRequest: (callback: (request: unknown) => void) => {
        w.ask = callback;
        return () => {};
      },
      sshQuitAnswer: async (answer: unknown) => {
        w.answers.push(answer);
      },
      sshQuitPrompt: async () => w.asks,
      setSshQuitPrompt: async (ask: boolean) => {
        w.asks = ask;
        return ask;
      },
    };
  });
  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
}

const request = (id: string) => ({
  id,
  hosts: [
    {
      hostId: 'h1',
      hostName: 'Build server',
      runs: [{ id: 'r1', label: 'Fix the build' }],
      shells: [{ id: 's1', label: 'Shell in /srv/app' }],
    },
    {
      hostId: 'h2',
      hostName: 'Lab',
      runs: [{ id: 'r2', label: 'Codex chat' }],
      shells: [],
    },
  ],
});
const ask = (page: Page, id: string) =>
  page.evaluate((value) => (window as any).ask(value), request(id));
const answers = (page: Page) => page.evaluate(() => (window as any).answers);
const question = (page: Page) => page.getByRole('dialog', { name: 'Work continues on SSH hosts' });

test('the quit question lists the work of each host, and Escape keeps it running', async ({
  page,
}) => {
  await fixture(page);
  await ask(page, 'q1');
  const dialog = question(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    '2 agent runs and 1 shell on 2 SSH hosts continue after Kalkidan quits.',
  );
  const build = dialog.getByRole('region', { name: 'Build server' });
  await expect(build).toContainText('Agent run: Fix the build');
  await expect(build).toContainText('Shell in /srv/app');
  await expect(dialog.getByRole('region', { name: 'Lab' })).toContainText('Agent run: Codex chat');
  // Keep running is the default.
  await expect(dialog.getByRole('button', { name: 'Keep running' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await answers(page)).toEqual([{ id: 'q1', choice: 'keep', dontAsk: false }]);
});

test('Stop all with "Don\'t ask again" answers once, and Preferences turns the question on', async ({
  page,
}) => {
  await fixture(page);
  await ask(page, 'q2');
  const dialog = question(page);
  await dialog.getByRole('checkbox', { name: "Don't ask again" }).check();
  await dialog.getByRole('button', { name: 'Stop all' }).click();
  await expect(dialog).toBeHidden();
  expect(await answers(page)).toEqual([{ id: 'q2', choice: 'stop', dontAsk: true }]);
  // The main process saves "Don't ask again". Preferences shows it and can turn it on again.
  await page.evaluate(() => ((window as any).asks = false));
  const preferences = await openPreferences(page);
  const toggle = preferences.getByRole('switch', {
    name: 'Ask before quitting while SSH work runs',
  });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => (window as any).asks)).toBe(true);
  // A new question starts with the box clear.
  await page.keyboard.press('Escape');
  await ask(page, 'q3');
  await expect(question(page).getByRole('checkbox', { name: "Don't ask again" })).not.toBeChecked();
  await question(page).getByRole('button', { name: 'Keep running' }).click();
  expect((await answers(page)).at(-1)).toEqual({ id: 'q3', choice: 'keep', dontAsk: false });
});
