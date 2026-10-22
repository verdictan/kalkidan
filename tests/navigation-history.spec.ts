import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

test('titlebar history traverses boards, repositories and chats, preserves drafts and branches', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('.topbar');
  const back = header.getByRole('button', { name: 'Go back', exact: true });
  const forward = header.getByRole('button', { name: 'Go forward', exact: true });
  await expect(header.getByRole('button', { name: 'Project overview' })).toHaveCount(0);
  await expect(header).not.toContainText('Kalkidan');
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  const projects = page.getByRole('region', { name: 'Projects', exact: true });
  const overview = page
    .getByRole('main')
    .getByRole('textbox', { name: 'Message for a new chat', exact: true });
  const tracker = page.getByRole('region', { name: 'Project tracker', exact: true });
  await expect(projects).toBeVisible();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(overview).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Project page' })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(tracker).toBeVisible();
  await openCodeFolder(page);
  await page
    .getByRole('button', { name: 'Resume Refine project and repository navigation', exact: true })
    .click();
  await page.getByLabel('Message agent').fill('Keep this draft while navigating');
  await back.click();
  await expect(page.locator('.repository-overview')).toBeVisible();
  await back.click();
  await expect(overview).toBeVisible();
  await back.click();
  await expect(tracker).toBeVisible();
  await back.click();
  await expect(overview).toBeVisible();
  await back.click();
  await expect(projects).toBeVisible();
  await expect(back).toBeDisabled();
  for (let step = 0; step < 5; step++) await forward.click();
  await expect(page.getByLabel('Message agent')).toHaveValue('Keep this draft while navigating');
  await expect(forward).toBeDisabled();
  await back.click();
  await openCodeFolder(page, 'design-system');
  await expect(forward).toBeDisabled();
  await page.setViewportSize({ width: 773, height: 988 });
  await expect(back).toBeInViewport();
  await expect(header.getByRole('button', { name: 'Toggle sidebar' })).toBeInViewport();
});
