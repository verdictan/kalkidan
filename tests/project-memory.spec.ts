import { test, expect } from '@playwright/test';

test('Memory is beneath Docs and opens a read-only project page', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  const docs = page.getByRole('button', { name: 'Docs', exact: true });
  const memory = page.getByRole('button', { name: 'Memory', exact: true });
  const docsBox = await docs.boundingBox();
  const memoryBox = await memory.boundingBox();
  expect(memoryBox!.y).toBeGreaterThan(docsBox!.y);
  await memory.click();
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  await expect(panel.getByRole('heading', { name: 'Atlas memory' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'No project memory yet' })).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Refresh memory' }).click();
  await expect(panel.getByRole('heading', { name: 'No project memory yet' })).toBeVisible();
  await docs.click();
  await expect(page.getByRole('complementary', { name: 'Document pages' })).toBeVisible();
});

test('Memory renders agent files and refreshes changes without editing controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).memoryBody = 'Run npm test.';
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Test', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      memoryList: async () => ({
        pages: [
          {
            name: 'testing.md',
            content: '# Test conventions\n\n' + (window as any).memoryBody,
            updatedAt: '2026-10-20T12:00:00Z',
            truncated: false,
          },
        ],
        limited: false,
      }),
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  await expect(panel.getByRole('heading', { name: 'Test conventions' })).toBeVisible();
  await expect(panel).toContainText('Run npm test.');
  await page.evaluate(() => {
    (window as any).memoryBody = 'Run npm test and lint.';
  });
  await panel.getByRole('button', { name: 'Refresh memory' }).click();
  await expect(panel).toContainText('Run npm test and lint.');
  await expect(panel.locator('textarea, input, [contenteditable="true"]')).toHaveCount(0);
  await page.setViewportSize({ width: 757, height: 988 });
  await expect(panel.getByRole('heading', { name: 'Test conventions' })).toBeVisible();
});
