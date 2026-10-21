import { test, expect, type Page } from '@playwright/test';

// The sidebar hides Get started after setup is complete. The search actions keep it.
async function openSetup(page: Page) {
  await page.getByLabel('Search projects and sessions').fill('Get started');
  await page
    .getByRole('region', { name: 'Search results' })
    .getByRole('option', { name: /Get started/ })
    .click();
}

test('empty workspace starts onboarding once and can resume after dismissal', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      agentInstallations: async () => [{ agent: 'codex', status: 'missing' }],
    };
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set up your first session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose code folder', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open first session' })).toBeDisabled();
  await page.getByRole('button', { name: 'Set up later' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your first session' })).toBeVisible();
});

test('existing workspace can prepare an editable first message without sending it', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openSetup(page);
  await expect(page.getByRole('combobox', { name: 'Setup project' })).toContainText('Atlas');
  await page.getByRole('combobox', { name: 'Starter message' }).click();
  await page.getByRole('option', { name: 'Plan a change', exact: true }).click();
  await expect(page.getByLabel('First message', { exact: true })).toHaveValue(
    /Help me plan a change/,
  );
  await page
    .getByLabel('First message', { exact: true })
    .fill('Inspect the authentication flow and suggest an integration test plan.');
  await page.screenshot({ path: 'test-results/onboarding.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Open first session' }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(
    'Inspect the authentication flow and suggest an integration test plan.',
  );
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('agent check failure is recoverable and short screens keep setup actions accessible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let checks = 0;
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/tmp/repo', favorite: false, notes: '', addedAt: '' },
        ],
        groups: [{ id: 'g', name: 'Project', repoIds: ['r'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      agentInstallations: async () => {
        if (++checks === 1) throw Error('Temporary failure');
        return [{ agent: 'codex', status: 'installed' }];
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 650 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  const status = page.getByRole('dialog').getByRole('status');
  await expect(status).toContainText('Temporary failure');
  // The session opens with a draft only, so a failed check does not block it.
  await expect(page.getByRole('button', { name: 'Open first session' })).toBeEnabled();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(status).toContainText('Codex is installed');
  await expect(status).toContainText('managed Verdictan agent');
  await page.getByRole('button', { name: 'Set up later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('project and repository setup return to the checklist', async ({ page }) => {
  await page.goto('/');
  await openSetup(page);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Project name');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your first session' })).toBeVisible();
  await page.getByRole('button', { name: 'Add code folder', exact: true }).click();
  // The demo has no GitHub CLI, so the dialog starts with a local folder.
  await expect(page.getByRole('dialog').last()).toContainText('Choose folder');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your first session' })).toBeVisible();
});

test('a missing agent check shows an error, and an empty overview has one New project action', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Could not check agents');
  await page.getByRole('button', { name: 'Set up later' }).click();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'New project', exact: true }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
