import { type Page } from '@playwright/test';
import { test, expect, settingsDialog, settingsSection } from './helpers/app';
import { openProjectTab } from './helpers/navigation';

/** Opens the project section of Settings from the "Project actions" menu of the project header. */
async function openFromHeader(page: Page) {
  await page.locator('.project-header').getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
}

const settings = (page: Page) => settingsDialog(page);
/** The section of one project in Settings. Its tab and its title are the project name. */
const project = (page: Page, name: string) =>
  settings(page).getByRole('tabpanel', { name, exact: true });

test('the project section of Settings has the name, color, code folders, board and Remove', async ({
  page,
}) => {
  await page.goto('/');
  // The header menu opens Settings at the project on every tab. The page stays the same.
  await openProjectTab(page, 'Docs', 'Atlas');
  await openFromHeader(page);
  await expect(settings(page)).toBeVisible();
  await expect(settingsSection(page, 'Atlas')).toHaveAttribute('aria-selected', 'true');
  // The section title is the project name, and it gets the focus.
  await expect(settings(page).getByRole('heading', { name: 'Atlas', exact: true })).toBeFocused();
  // The dialog hides the page from assistive technology, so find the page by its class.
  await expect(page.locator('.knowledge-search')).toBeAttached();
  const atlas = project(page, 'Atlas');
  // One section with the name, the color, the code folders, the board and Remove project.
  await expect(atlas.getByRole('region')).toHaveText([/^Code folders/, /^Board/]);

  // The name and the color. A local project shows no host.
  const name = atlas.getByRole('textbox', { name: 'Project name', exact: true });
  await expect(name).toHaveValue('Atlas');
  // A color saves at once, with Undo.
  const colors = atlas.getByRole('group', { name: 'Color', exact: true }).last();
  await colors.getByRole('button', { name: 'Green folder', exact: true }).click();
  await expect(colors.getByRole('button', { name: 'Green folder' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: 'Color changed to green.' });
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  // The name saves on Enter. There is no Save button.
  await expect(atlas.getByRole('button', { name: 'Save project' })).toHaveCount(0);
  await name.fill('Atlas web');
  await expect(atlas).toContainText('Press Enter to save.');
  await name.press('Enter');
  // The tab and the title follow the new name.
  await expect(settingsSection(page, 'Atlas web')).toHaveAttribute('aria-selected', 'true');
  await expect(project(page, 'Atlas web')).toContainText('Saved');
  const row = page.locator('.project-tree').getByRole('button', { name: 'Atlas web', exact: true });
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(page.locator('.project-header').getByRole('heading')).toHaveText('Atlas web');

  // Code folders: the list, Add code folder and Remove with a confirmation.
  await openFromHeader(page);
  const web = project(page, 'Atlas web');
  const folders = web
    .getByRole('region', { name: 'Code folders' })
    .getByRole('list', { name: 'Code folders' });
  await expect(folders.getByRole('group')).toHaveCount(3);
  await expect(web.getByRole('button', { name: 'Add code folder…', exact: true })).toBeVisible();
  // Each code folder has a remove button. The confirmation opens over Settings.
  await folders
    .getByRole('button', { name: 'Remove code folder api-service…', exact: true })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Remove api-service from Atlas web?' });
  await expect(confirm).toContainText('stay on disk');
  await confirm.getByRole('button', { name: 'Remove code folder', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
  await expect(folders.getByRole('group')).toHaveCount(2);

  // Board: no board is connected, so the group offers "Connect board…". The empty state is
  // plain text, not a heading.
  const board = web.getByRole('region', { name: 'Board', exact: true });
  await expect(board.getByText('No board', { exact: true })).toBeVisible();
  await expect(board.getByRole('heading', { name: /^No board/ })).toHaveCount(0);
  await expect(board.getByRole('button', { name: 'Connect board…', exact: true })).toBeVisible();

  // Remove project is a quiet row at the end, with its confirmation. There is no Danger zone.
  await expect(web).not.toContainText('Danger zone');
  await web.getByRole('button', { name: 'Remove project…' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Atlas web?', exact: true });
  await expect(remove).toContainText('All files stay on disk.');
  await remove.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(row).toBeVisible();
  // The sidebar menu of the project opens the same section.
  await page.getByRole('button', { name: 'Manage project Atlas web', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  await project(page, 'Atlas web').getByRole('button', { name: 'Remove project…' }).click();
  await remove.getByRole('button', { name: 'Remove project', exact: true }).click();
  await expect(row).toHaveCount(0);
  // The section of a removed project closes.
  await expect(settingsSection(page, 'Atlas web')).toHaveCount(0);
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
      remoteHosts: async () => [
        { id: 'h', name: 'Builder', target: 'dev@builder.example', status: 'connected' },
      ],
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage project Remote', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
  await expect(settingsSection(page, 'Remote')).toHaveAttribute('aria-selected', 'true');
  // The host name shows below the project name.
  await expect(
    project(page, 'Remote').getByRole('group', { name: 'Name', exact: true }),
  ).toContainText('Builder');
});
