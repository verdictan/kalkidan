import { test, expect } from '@playwright/test';

test('Memory is beneath Docs and opens a read-only project page', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  const tree = page.getByRole('navigation', { name: 'Projects and repositories' });
  const docs = tree.getByRole('button', { name: 'Docs', exact: true });
  const memory = tree.getByRole('button', { name: 'Memory', exact: true });
  const docsBox = await docs.boundingBox();
  const memoryBox = await memory.boundingBox();
  expect(memoryBox!.y).toBeGreaterThan(docsBox!.y);
  await memory.click();
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  await expect(panel.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
  await expect(panel.locator('header').first()).toContainText('Atlas');
  // The demo has saved entries. The page shows them by topic and has no text fields.
  const topics = panel.getByRole('navigation', { name: 'Memory topics' });
  await expect(topics.getByRole('button', { name: 'Testing', exact: true })).toBeVisible();
  await expect(panel.getByRole('article', { name: 'Testing' })).toContainText('npm run test:ui');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Refresh memory' }).click();
  await topics.getByRole('button', { name: 'Authentication', exact: true }).click();
  await expect(panel.getByRole('article', { name: 'Authentication' })).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await docs.click();
  await expect(page.getByRole('complementary', { name: 'Document pages' })).toBeVisible();
});

test('Memory renders agent files and refreshes changes without editing controls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).memoryBody = 'Run npm test.';
    (window as any).memoryReads = 0;
    (window as any).memoryRevisionReads = 0;
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Test', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      projectResourceRevision: async () => {
        (window as any).memoryRevisionReads++;
        return (window as any).memoryBody;
      },
      memoryList: async () => {
        (window as any).memoryReads++;
        return {
          pages: [
            {
              name: 'testing.md',
              content: '# Test conventions\n\n' + (window as any).memoryBody,
              updatedAt: '2026-10-20T12:00:00Z',
              truncated: false,
            },
          ],
          limited: false,
        };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  await expect(panel.getByRole('heading', { name: 'Test conventions' })).toBeVisible();
  await expect(panel).toContainText('Run npm test.');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => page.evaluate(() => (window as any).memoryRevisionReads))
    .toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => (window as any).memoryReads)).toBe(1);
  await page.evaluate(() => {
    (window as any).memoryBody = 'Run npm test and lint.';
  });
  await panel.getByRole('button', { name: 'Refresh memory' }).click();
  await expect(panel).toContainText('Run npm test and lint.');
  await expect(panel.locator('textarea, input, [contenteditable="true"]')).toHaveCount(0);
  await page.setViewportSize({ width: 757, height: 988 });
  await expect(panel.getByRole('heading', { name: 'Test conventions' })).toBeVisible();
});

test('late Memory reads cannot display content in another project', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'a', name: 'Alpha', repoIds: [] },
          { id: 'b', name: 'Beta', repoIds: [] },
        ],
      }),
      memoryList: async (id: string) => {
        if (id === 'a')
          return new Promise((resolve) => {
            (window as any).resolveAlpha = resolve;
          });
        throw Error('Beta is offline');
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Memory', exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).resolveAlpha))
    .toBe('function');
  await page.getByRole('button', { name: 'Memory', exact: true }).nth(1).click();
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  await expect(panel.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
  await expect(panel.locator('header').first()).toContainText('Beta');
  await expect(page.getByRole('alert')).toContainText('Beta is offline');
  await page.evaluate(() =>
    (window as any).resolveAlpha({
      pages: [
        { name: 'private.md', content: 'Alpha private fact', updatedAt: '', truncated: false },
      ],
      limited: false,
    }),
  );
  await expect(page.getByText('Alpha private fact')).toHaveCount(0);
});
