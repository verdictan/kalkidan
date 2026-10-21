import { test, expect, type Page } from '@playwright/test';
import { openProjectTab } from './helpers/navigation';

const settings = (page: Page) =>
  page.getByRole('dialog', { name: 'Project settings', exact: true });
const section = (page: Page, name: string) =>
  settings(page).getByRole('tab', { name, exact: true });

test('Project settings has General, Code folders, Board and Danger zone sections', async ({
  page,
}) => {
  await page.goto('/');
  // The header button opens the dialog on every tab. The page stays the same.
  await openProjectTab(page, 'Docs', 'Atlas');
  await page.locator('.project-header').getByRole('button', { name: 'Project settings' }).click();
  await expect(settings(page)).toBeVisible();
  // The dialog hides the page from assistive technology, so find the page by its class.
  await expect(page.locator('.docs-library')).toBeAttached();
  await expect(settings(page).getByRole('tab')).toHaveText([
    'General',
    'Code folders',
    'Board connection',
    'Danger zone',
  ]);

  // General: name, color, and where work runs. The location cannot change.
  await expect(section(page, 'General')).toHaveAttribute('aria-selected', 'true');
  const name = settings(page).getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toHaveValue('Atlas');
  const where = settings(page).getByRole('region', { name: 'Where work runs' });
  await expect(where).toContainText('This computer');
  await expect(where).toContainText('You cannot change where work runs.');
  await expect(settings(page).getByRole('button', { name: 'Save project' })).toBeDisabled();
  await settings(page).getByRole('button', { name: 'Green folder', exact: true }).click();
  await name.fill('Atlas web');
  await settings(page).getByRole('button', { name: 'Save project' }).click();
  await expect(settings(page)).toHaveCount(0);
  const row = page.locator('.project-tree').getByRole('button', { name: 'Atlas web', exact: true });
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
  await section(page, 'Board connection').click();
  await expect(settings(page).getByRole('region', { name: 'Connect a board' })).toBeVisible();

  // Danger zone: the existing remove flow and its confirmation.
  await section(page, 'Danger zone').click();
  await settings(page).getByRole('button', { name: 'Remove project…' }).click();
  await expect(settings(page)).toHaveCount(0);
  const remove = page.getByRole('dialog', { name: 'Remove Atlas web from Kalkidan?' });
  await expect(remove).toContainText('All files stay on disk.');
  await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Manage project Atlas web', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  await section(page, 'Danger zone').click();
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
  const where = settings(page).getByRole('region', { name: 'Where work runs' });
  await expect(where).toContainText('SSH host: Builder');
  await expect(where).toContainText('dev@builder.example · connected');
  await expect(where).toContainText('Project folder: /home/dev/remote');
});
