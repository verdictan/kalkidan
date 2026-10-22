import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

test('Memory follows Docs in the project tabs and opens a read-only project page', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  const docs = tabs.getByRole('button', { name: 'Docs', exact: true });
  const memory = tabs.getByRole('button', { name: 'Memory', exact: true });
  const docsBox = await docs.boundingBox();
  const memoryBox = await memory.boundingBox();
  expect(memoryBox!.x).toBeGreaterThan(docsBox!.x);
  await memory.click();
  await expect(memory).toHaveAttribute('aria-current', 'page');
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  // One project header shows the project name above the tabs. Memory has no header of its own.
  await expect(page.locator('.project-header')).toContainText('Atlas');
  await expect(panel.locator('header')).toHaveCount(0);
  // The demo has saved entries. The page shows them by topic and has no text fields.
  const topics = panel.getByRole('navigation', { name: 'Memory topics' });
  await expect(topics.getByRole('button', { name: 'Testing', exact: true })).toBeVisible();
  await expect(panel.getByRole('article', { name: 'Testing' })).toContainText('npm run test:ui');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh memory' }).click();
  await topics.getByRole('button', { name: 'Authentication', exact: true }).click();
  await expect(panel.getByRole('article', { name: 'Authentication' })).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await docs.click();
  await expect(docs).toHaveAttribute('aria-current', 'page');
  // A project without pages shows the empty Docs page and no page list.
  await expect(page.getByRole('heading', { name: 'No docs yet' })).toBeVisible();
});

test('Memory renders agent files and refreshes changes without open edit fields', async ({
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
  await page.goto('/');
  await openProjectTab(page, 'Memory');
  const panel = page.getByRole('region', { name: 'Project memory', exact: true });
  await expect(panel.getByRole('heading', { name: 'Test conventions' })).toBeVisible();
  await expect(panel).toContainText('Run npm test.');
  // The project overview can read memory too. Count the reads from here.
  const reads = await page.evaluate(() => (window as any).memoryReads);
  const revisions = await page.evaluate(() => (window as any).memoryRevisionReads);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => page.evaluate(() => (window as any).memoryRevisionReads))
    .toBeGreaterThan(revisions);
  await expect.poll(() => page.evaluate(() => (window as any).memoryReads)).toBe(reads);
  await page.evaluate(() => {
    (window as any).memoryBody = 'Run npm test and lint.';
  });
  await page.getByRole('button', { name: 'Refresh memory' }).click();
  await expect(panel).toContainText('Run npm test and lint.');
  // The entries are not edit fields. The one field is Search memory. An entry form opens only
  // from Add entry or Edit.
  await expect(panel.locator('textarea, [contenteditable="true"]')).toHaveCount(0);
  await expect(panel.locator('input')).toHaveCount(1);
  await expect(panel.getByRole('searchbox', { name: 'Search memory' })).toBeVisible();
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
  await page.goto('/');
  await openProjectTab(page, 'Memory');
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).resolveAlpha))
    .toBe('function');
  await openProjectTab(page, 'Memory', 'Beta');
  await expect(page.getByRole('region', { name: 'Project memory', exact: true })).toBeVisible();
  await expect(page.locator('.project-header')).toContainText('Beta');
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

for (const ready of [true, false])
  test(`empty Memory chooses its action from managed agent state (ready: ${ready})`, async ({
    page,
  }) => {
    await page.addInitScript((isReady) => {
      (window as any).workspace = {
        trackerProviders: async () => [],
        snapshot: async () => ({
          projects: [],
          groups: [{ id: 'g', name: 'Test', repoIds: [] }],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        memoryList: async () => ({ pages: [], limited: false }),
        verdictanStatus: async () =>
          isReady
            ? { phase: 'authenticated', executionReady: true }
            : { phase: 'missing', executionReady: false },
        verdictanSetup: async () => ({ selections: { claude: {} } }),
      };
    }, ready);
    await page.goto('/');
    await openProjectTab(page, 'Memory');
    const panel = page.getByRole('region', { name: 'Project memory', exact: true });
    await expect(panel).toContainText('No memory yet');
    const start = panel.getByRole('button', { name: 'Start a chat', exact: true });
    const setUp = panel.getByRole('button', { name: 'Set up managed agents', exact: true });
    if (ready) {
      await expect(start).toBeVisible();
      await expect(setUp).toHaveCount(0);
    } else {
      await expect(setUp).toBeVisible();
      await expect(start).toHaveCount(0);
    }
  });
