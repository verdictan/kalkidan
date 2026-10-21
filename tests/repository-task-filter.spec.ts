import { test, expect } from '@playwright/test';
import { openCodeFolder } from './helpers/navigation';

test('repository overview omits tasks while the project Board page retains them', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('region', { name: 'Project tracker' })
    .getByRole('button', { name: 'Connect a GitHub Projects board', exact: true })
    .click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await openCodeFolder(page, 'atlas-web');
  await expect(page.getByRole('region', { name: 'Repository project tasks' })).toHaveCount(0);
  await openCodeFolder(page, 'api-service');
  await expect(page.getByRole('region', { name: 'Repository project tasks' })).toHaveCount(0);
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  await expect(page.getByText('Build the project overview', { exact: true })).toBeVisible();
  await expect(page.getByText('Review authentication', { exact: true })).toBeVisible();
});
