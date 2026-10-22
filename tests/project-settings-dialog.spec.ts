import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

const settings = (page: Page) =>
  page.getByRole('dialog', { name: 'Project settings', exact: true });
const section = (page: Page, name: string) =>
  settings(page).getByRole('tab', { name, exact: true });

test('Project settings has General, Code folders and Board sections', async ({ page }) => {
  await page.goto('/');
  // The header button opens the dialog on every tab. The page stays the same.
  await openProjectTab(page, 'Docs', 'Atlas');
  await page.locator('.project-header').getByRole('button', { name: 'Project settings' }).click();
  await expect(settings(page)).toBeVisible();
  // The dialog hides the page from assistive technology, so find the page by its class.
  await expect(page.locator('.docs-layout')).toBeAttached();
  // Without a board, there is no Automatic status changes section.
  await expect(settings(page).getByRole('tab')).toHaveText(['General', 'Code folders', 'Board']);

  // General: name, color, where work runs, and Remove project. The location cannot change.
  await expect(section(page, 'General')).toHaveAttribute('aria-selected', 'true');
  const name = settings(page).getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toHaveValue('Atlas');
  await expect(settings(page)).toContainText('This computer');
  await expect(settings(page)).toContainText('To use a different computer, create a new project');
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
  await page.locator('.project-header').getByRole('button', { name: 'Project settings' }).click();
  await section(page, 'Code folders').click();
  const folders = settings(page).getByRole('region', { name: 'Code folders' });
  await expect(folders.getByRole('listitem')).toHaveCount(3);
  await folders.getByRole('button', { name: 'Add a code folder…' }).click();
  await expect(settings(page)).toHaveCount(0);
  const add = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toContainText('Atlas web');
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.project-header').getByRole('button', { name: 'Project settings' }).click();
  await section(page, 'Code folders').click();
  await folders.getByRole('button', { name: 'Remove api-service from this project' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove api-service from Kalkidan?' });
  await expect(confirm).toContainText('stay on disk');
  await confirm.getByRole('button', { name: 'Remove from Kalkidan', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await page.locator('.project-header').getByRole('button', { name: 'Project settings' }).click();
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
  // "Runs on" names the host, its address and the project folder.
  await expect(settings(page)).toContainText('Runs on');
  await expect(settings(page)).toContainText('Builder · dev@builder.example · /home/dev/remote');
  await expect(settings(page)).toContainText('To use a different computer, create a new project');
});
