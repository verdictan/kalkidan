import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

/** Opens Project settings from the "Project actions" menu of the project header. */
async function openFromHeader(page: Page) {
  await page.locator('.project-header').getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
}

const settings = (page: Page) => page.getByRole('dialog', { name: /^Project settings: / });
const section = (page: Page, name: string) =>
  settings(page).getByRole('tab', { name, exact: true });

test('Project settings has General, Code folders and Board sections', async ({ page }) => {
  await page.goto('/');
  // The header menu opens the dialog on every tab. The page stays the same.
  await openProjectTab(page, 'Docs', 'Atlas');
  await openFromHeader(page);
  await expect(settings(page)).toBeVisible();
  await expect(settings(page)).toHaveAccessibleName('Project settings: Atlas');
  // The dialog hides the page from assistive technology, so find the page by its class.
  await expect(page.locator('.knowledge-search')).toBeAttached();
  // Without a board, there is no Automatic status changes section.
  await expect(settings(page).getByRole('tab')).toHaveText(['General', 'Code folders', 'Board']);

  // General: name, color and Remove project. A local project shows no host.
  await expect(section(page, 'General')).toHaveAttribute('aria-selected', 'true');
  const name = settings(page).getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toHaveValue('Atlas');
  await expect(settings(page)).toContainText('Atlas · No board');
  // A color saves at once, with Undo.
  await settings(page).getByRole('button', { name: 'Green folder', exact: true }).click();
  await expect(settings(page).getByRole('button', { name: 'Green folder' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Folder color changed to green.').last()).toBeVisible();
  // The name saves on Enter. There is no Save button.
  await expect(settings(page).getByRole('button', { name: 'Save project' })).toHaveCount(0);
  await name.fill('Atlas web');
  await expect(settings(page)).toContainText('Press Enter to save.');
  await name.press('Enter');
  await expect(settings(page)).toContainText('Saved');
  const row = page.locator('.project-tree').getByRole('button', { name: 'Atlas web', exact: true });
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(page.locator('.project-header').getByRole('heading')).toHaveText('Atlas web');

  // Code folders: the list, Add a code folder and Remove with a confirmation.
  await openFromHeader(page);
  await section(page, 'Code folders').click();
  const folders = settings(page).getByRole('region', { name: 'Code folders' });
  await expect(folders.getByRole('listitem')).toHaveCount(3);
  await folders.getByRole('button', { name: 'Add a code folder…' }).click();
  await expect(settings(page)).toHaveCount(0);
  const add = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toContainText('Atlas web');
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openFromHeader(page);
  await section(page, 'Code folders').click();
  await folders.getByRole('button', { name: 'More actions for api-service' }).click();
  await page.getByRole('menuitem', { name: 'Remove from project…', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove api-service from Kalkidan?' });
  await expect(confirm).toContainText('stay on disk');
  await confirm.getByRole('button', { name: 'Remove from Kalkidan', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await openFromHeader(page);
  await section(page, 'Code folders').click();
  await expect(folders.getByRole('listitem')).toHaveCount(2);

  // Board: the existing board connection.
  await section(page, 'Board').click();
  await expect(settings(page).getByRole('region', { name: 'Connect a board' })).toBeVisible();

  // Remove project is at the end of General, with its confirmation.
  await section(page, 'General').click();
  await settings(page).getByRole('button', { name: 'Remove project…' }).click();
  await expect(settings(page)).toHaveCount(0);
  const remove = page.getByRole('dialog', { name: 'Remove Atlas web from Kalkidan?' });
  await expect(remove).toContainText('All files stay on disk.');
  await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Manage project Atlas web', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  await settings(page).getByRole('button', { name: 'Remove project…' }).click();
  await remove.getByRole('button', { name: 'Remove project', exact: true }).click();
  await expect(row).toHaveCount(0);
});

test('an SSH project shows its host as where work runs', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [
          {
            id: 'g',
            name: 'Remote',
            repoIds: [],
            hostId: 'h',
            rootPath: '/home/dev/remote',
          },
        ],
        hosts: [{ id: 'h', name: 'Builder', target: 'dev@builder.example', status: 'connected' }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage project Remote', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  // The host name shows below the project name.
  await expect(settings(page)).toHaveAccessibleName('Project settings: Remote');
  await expect(settings(page).getByRole('navigation')).toContainText('Builder');
});
