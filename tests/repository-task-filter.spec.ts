import { test, expect } from '@playwright/test';

test('repository overview omits tasks while the project Board page retains them', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  await page.locator('.repo-select').filter({ hasText: 'atlas-web' }).click();
  await expect(page.getByRole('region', { name: 'Repository project tasks' })).toHaveCount(0);
  await page.locator('.repo-select').filter({ hasText: 'api-service' }).click();
  await expect(page.getByRole('region', { name: 'Repository project tasks' })).toHaveCount(0);
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Filter by repository' })).toBeVisible();
  await expect(page.getByText('Build the project overview', { exact: true })).toBeVisible();
  await expect(page.getByText('Review authentication', { exact: true })).toBeVisible();
});
