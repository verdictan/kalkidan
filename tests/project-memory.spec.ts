import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

/** The rail of the Knowledge tab. */
const rail = (page: Page) => page.getByRole('complementary', { name: 'Knowledge sections' });

/** The Memory pane. The rail has a Memory group too, so look in the pane. */
const memoryPane = (page: Page) =>
  page.locator('.knowledge-pane').getByRole('region', { name: 'Memory', exact: true });

/** Opens all facts in the Memory section of the Knowledge tab. */
async function openMemory(page: Page, project?: string) {
  await openProjectTab(page, 'Knowledge', project);
  await rail(page)
    .getByRole('button', { name: /^All facts( \d+)?$/ })
    .click();
}

test('Memory is a section of the Knowledge tab and shows facts by topic without edit fields', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  const knowledge = tabs.getByRole('button', { name: 'Knowledge', exact: true });
  await knowledge.click();
  await expect(knowledge).toHaveAttribute('aria-current', 'page');
  // The Memory group follows the Pages group in the rail.
  const pagesBox = await rail(page)
    .getByRole('region', { name: 'Pages', exact: true })
    .boundingBox();
  const memoryBox = await rail(page)
    .getByRole('region', { name: 'Memory', exact: true })
    .boundingBox();
  expect(memoryBox!.y).toBeGreaterThan(pagesBox!.y);
  const allFacts = rail(page).getByRole('button', { name: /^All facts( \d+)?$/ });
  await allFacts.click();
  await expect(allFacts).toHaveAttribute('aria-current', 'page');
  const panel = memoryPane(page);
  // One project header shows the project name above the tabs.
  await expect(page.locator('.project-header')).toContainText('Atlas');
  // The demo has saved facts. The pane shows them by topic and has no text fields.
  await expect(panel.getByRole('region', { name: /^Testing/ })).toContainText('npm run test:ui');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  const topic = rail(page).getByRole('button', { name: /^Authentication( \d+)?$/ });
  await topic.click();
  await expect(topic).toHaveAttribute('aria-current', 'page');
  await expect(panel.getByRole('region', { name: /^Authentication/ })).toBeVisible();
  await expect(panel.getByRole('textbox')).toHaveCount(0);
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
      docsMetadata: async () => [],
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
  await openMemory(page);
  const panel = memoryPane(page);
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
  // When the window gets focus again, a changed revision loads the facts again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel).toContainText('Run npm test and lint.');
  // The facts are not edit fields. The search is in the rail. A fact form opens only from Add
  // fact or Edit fact.
  await expect(panel.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
  await expect(rail(page).getByRole('combobox', { name: 'Search knowledge' })).toBeVisible();
  await page.setViewportSize({ width: 757, height: 988 });
  await expect(panel.getByRole('heading', { name: 'Test conventions' })).toBeVisible();
});

test('late Memory reads cannot display content in another project', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      docsMetadata: async () => [],
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
  await openMemory(page);
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).resolveAlpha))
    .toBe('function');
  await openMemory(page, 'Beta');
  await expect(memoryPane(page)).toBeVisible();
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
        docsMetadata: async () => [],
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
    await openMemory(page);
    const panel = memoryPane(page);
    await expect(panel).toContainText('No facts yet');
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
