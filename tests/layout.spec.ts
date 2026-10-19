import { test, expect } from '@playwright/test';

test('repository dialog contains long names, scrolls results, and keeps actions visible on compact windows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.addInitScript(() => {
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        groups: [
          {
            id: 'g',
            name: 'Customer platform and shared infrastructure across multiple repositories',
            repoIds: [],
          },
        ],
        warnings: [],
        platform: 'darwin',
      }),
      githubAuthStart: async () => ({ status: 'ready' }),
      githubAuthCancel: async () => ({}),
      githubOwners: async () => [],
      githubRepositories: async () =>
        Array.from({ length: 40 }, (_, i) => ({
          nameWithOwner:
            'example-organization/shared-infrastructure-and-customer-platform-repository-' + i,
          description:
            'A repository with a longer description to check wrapping and alignment next to visibility badges.',
          isPrivate: true,
          isArchived: false,
        })),
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page
    .getByRole('button', {
      name: 'Add repositories to Customer platform and shared infrastructure across multiple repositories',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Add to project' }).click();
  await page
    .getByRole('option', {
      name: 'Customer platform and shared infrastructure across multiple repositories',
    })
    .click();
  const last = dialog.getByRole('button', { name: /repository-39 / });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(
    dialog.getByRole('button', { name: 'Clone into project', exact: true }),
  ).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/repository-dialog-spacing.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Create a new project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('New project');
  await expect(create.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled();
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Clone into project', exact: true }),
  ).toBeInViewport();
  await dialog.getByRole('button', { name: 'Local folders', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Choose folders', exact: true }),
  ).toBeInViewport();
});

test('notifications and a long draft do not push the composer outside the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'Edit repository', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Project updated.');
  await page.getByRole('button', { name: 'Codex New session', exact: true }).click();
  await page
    .getByLabel('Message agent')
    .fill('Review the repository and explain the next steps.\n'.repeat(20));
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport({
    ratio: 1,
  });
  const welcome = page.getByRole('heading', { name: 'What are we working on?', exact: true });
  expect(
    await welcome.evaluate(
      (el) =>
        el.getBoundingClientRect().top >=
        el.closest('.conversation-messages')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  expect(
    await page
      .locator('.conversation-welcome p')
      .evaluate(
        (el) =>
          el.getBoundingClientRect().bottom + 16 <=
          el
            .closest('.conversation-panel')!
            .querySelector('.conversation-composer')!
            .getBoundingClientRect().top,
      ),
  ).toBe(true);
  expect(
    await page
      .getByRole('region', { name: 'Session conversations', exact: true })
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/compact-composer-spacing.png', fullPage: true });
});
