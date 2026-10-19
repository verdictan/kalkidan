import { test, expect } from '@playwright/test';

test('titlebar history traverses boards, repositories and chats, preserves drafts and branches', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  const header = page.locator('.topbar');
  const back = header.getByRole('button', { name: 'Go back', exact: true });
  const forward = header.getByRole('button', { name: 'Go forward', exact: true });
  await expect(header.getByRole('button', { name: 'Project overview' })).toHaveCount(0);
  await expect(header).not.toContainText('Kalkidan');
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project tracker', exact: true })).toBeVisible();
  await page.locator('.repo-select').first().click();
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  await page.getByLabel('Message agent').fill('Keep this draft while navigating');
  await back.click();
  await expect(page.locator('section.detail')).toBeVisible();
  await back.click();
  await expect(page.getByRole('region', { name: 'Project tracker', exact: true })).toBeVisible();
  await back.click();
  await expect(page.getByRole('region', { name: 'Project overview', exact: true })).toBeVisible();
  await expect(back).toBeDisabled();
  await forward.click();
  await forward.click();
  await forward.click();
  await expect(page.getByLabel('Message agent')).toHaveValue('Keep this draft while navigating');
  await expect(forward).toBeDisabled();
  await back.click();
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'design-system', exact: true })
    .click();
  await expect(forward).toBeDisabled();
  await page.setViewportSize({ width: 773, height: 988 });
  await expect(back).toBeInViewport();
  await expect(header.getByRole('button', { name: 'Toggle sidebar' })).toBeInViewport();
});
