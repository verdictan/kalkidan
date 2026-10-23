import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

/** The rail of the Knowledge tab. */
const rail = (page: Page) => page.getByRole('complementary', { name: 'Knowledge sections' });

/** The Memory row of the rail. Memory is one row, pinned first. */
const memoryRow = (page: Page) => rail(page).getByRole('button', { name: 'Memory', exact: true });

/** The Memory pane. The rail has a Memory row too, so look in the pane. */
const memoryPane = (page: Page) =>
  page.locator('.knowledge-pane').getByRole('region', { name: 'Memory', exact: true });

/** Opens Memory in the Knowledge tab. */
async function openMemory(page: Page, project?: string) {
  await openProjectTab(page, 'Knowledge', project);
  await memoryRow(page).click();
}

test('Memory is the first row of the Knowledge rail and shows facts by topic as an outline', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  const knowledge = tabs.getByRole('button', { name: 'Knowledge', exact: true });
  await knowledge.click();
  await expect(knowledge).toHaveAttribute('aria-current', 'page');
  // The demo has saved facts, so Knowledge opens on Memory.
  await expect(memoryRow(page)).toHaveAttribute('aria-current', 'page');
  const panel = memoryPane(page);
  // One project header shows the project name above the tabs.
  await expect(page.locator('.project-header')).toContainText('Atlas');
  // Topics are headings and facts are bullets. A saved fact is a button until the user edits it.
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Memory');
  await expect(panel.getByRole('region', { name: /^Testing/ })).toContainText('npm run test:ui');
  const fact = panel.getByRole('button', { name: /^Edit fact: Run npm test and npm run test:ui/ });
  await expect(fact).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Fact', exact: true })).toHaveCount(0);
  // One way to add a fact: the last bullet.
  await expect(panel.getByRole('textbox', { name: 'Add a fact', exact: true })).toHaveCount(1);
  // A click on a fact edits it in place. Escape ends the edit without a save.
  await fact.click();
  const field = panel.getByRole('textbox', { name: 'Fact', exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(/npm run test:ui/);
  await field.press('Escape');
  await expect(panel.getByRole('textbox', { name: 'Fact', exact: true })).toHaveCount(0);
  await expect(fact).toBeVisible();
  // The pages follow the Memory row in the one rail list.
  await rail(page).getByRole('button', { name: 'New page', exact: true }).click();
  const title = page.getByLabel('Page title', { exact: true });
  await expect(title).toHaveValue('Untitled');
  await title.fill('Runbook');
  const pages = rail(page).getByRole('navigation', { name: 'Pages', exact: true });
  await expect(pages.getByRole('button', { name: 'Runbook', exact: true })).toBeVisible();
  await expect(memoryRow(page)).not.toHaveAttribute('aria-current', 'page');
  const memoryBox = await memoryRow(page).boundingBox();
  const pagesBox = await pages.boundingBox();
  expect(pagesBox!.y).toBeGreaterThan(memoryBox!.y);
  await memoryRow(page).click();
  await expect(memoryRow(page)).toHaveAttribute('aria-current', 'page');
  await expect(panel.getByRole('region', { name: /^Testing/ })).toBeVisible();
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
  // Facts from agent files have no saved entry, so they are not edit fields. The topic is
  // read-only, and the only field is "Add a fact". The search is in the rail.
  await expect(panel.getByRole('button', { name: /^Edit fact/ })).toHaveCount(0);
  await expect(panel.locator('input:not([readonly]), [contenteditable="true"]')).toHaveCount(0);
  await expect(panel.locator('textarea')).toHaveCount(1);
  await expect(panel.getByRole('textbox', { name: 'Add a fact', exact: true })).toBeVisible();
  await panel.getByText('Run npm test and lint.').click();
  await expect(panel.getByRole('textbox', { name: 'Fact', exact: true })).toHaveCount(0);
  await expect(rail(page).getByRole('searchbox', { name: 'Find in knowledge' })).toBeVisible();
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

// Round 10 removed the "No facts yet" empty state and its chat and setup actions. An empty
// project opens on Memory with the caret in "Add a fact", and Enter saves the typed fact.
test('empty Memory opens with the caret in Add a fact and saves a typed fact', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).saved = [];
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
      // The save stays open, so the typed line stays on the page.
      memorySave: (_group: string, input: unknown) => {
        (window as any).saved.push(input);
        return new Promise(() => {});
      },
    };
  });
  await page.goto('/');
  await openProjectTab(page, 'Knowledge');
  const panel = memoryPane(page);
  await expect(memoryRow(page)).toHaveAttribute('aria-current', 'page');
  const add = panel.getByRole('textbox', { name: 'Add a fact', exact: true });
  await expect(add).toBeFocused();
  await expect(panel).not.toContainText('No facts yet');
  await expect(panel.getByRole('button')).toHaveCount(0);
  await add.pressSequentially('Run npm test before a release.');
  await add.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as any).saved))
    .toEqual([{ topic: 'General', content: 'Run npm test before a release.' }]);
  await expect(add).toBeFocused();
  await expect(add).toHaveValue('');
});
