import { test, expect } from '@playwright/test';

test('repository overview scopes tasks while the project board retains all repositories', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect project', exact: true }).click();
  await page.locator('.repo-select').filter({ hasText: 'atlas-web' }).click();
  const tasks = page.getByRole('region', { name: 'Repository project tasks' });
  await expect(tasks.getByText('Build the project overview', { exact: true })).toBeVisible();
  await expect(tasks.getByText('Review authentication', { exact: true })).toHaveCount(0);
  await expect(tasks.getByRole('combobox', { name: 'Filter issues by repository' })).toHaveCount(0);
  await page.locator('.repo-select').filter({ hasText: 'api-service' }).click();
  await expect(tasks.getByText('Review authentication', { exact: true })).toBeVisible();
  await expect(tasks.getByText('Build the project overview', { exact: true })).toHaveCount(0);
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Filter issues by repository' })).toBeVisible();
  await expect(page.getByText('Build the project overview', { exact: true })).toBeVisible();
  await expect(page.getByText('Review authentication', { exact: true })).toBeVisible();
});
