import { test, expect } from './helpers/app';
import { openAddCodeFolders } from './helpers/navigation';

test('a project created with a code folder closes the flow and opens the new project', async ({
  page,
}) => {
  await page.goto('/');
  // An empty project shows "Add code folder…" in the Code folders section of its overview.
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Empty');
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(create).not.toBeVisible();
  await page
    .getByRole('region', { name: 'Code folders', exact: true })
    .getByRole('button', { name: 'Add code folder…', exact: true })
    .click();
  // The dialog knows the project, so it names the project and shows no Project field.
  const add = page.getByRole('dialog', { name: 'Add code folder', exact: true });
  await expect(add).toContainText('Adds a Git repository to Empty.');
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toHaveCount(0);
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(add).not.toBeVisible();

  // New project adds its code folder in the same dialog.
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  await create.getByLabel('Project name', { exact: true }).fill('Mobile');
  await create.getByRole('button', { name: 'Add code folder…', exact: true }).click();
  const found = page.getByRole('dialog', { name: /^Found \d+ Git repositories/ });
  await found.getByRole('button', { name: 'Select none', exact: true }).click();
  await found.getByRole('checkbox', { disabled: false }).first().check();
  await found.getByRole('button', { name: 'Add 1 code folder', exact: true }).click();
  await create.getByRole('button', { name: 'Create project', exact: true }).click();

  await expect(create).not.toBeVisible();
  // The flow is complete. No other dialog opens.
  await expect(page.getByText('Created Mobile with 1 code folder.').first()).toBeAttached();
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Created Mobile with 1 code folder' }),
  ).toBeVisible();
  // The new project shows.
  await expect(page.getByRole('main').getByRole('heading', { name: 'Mobile' })).toBeVisible();

  // The dialog of another project still adds to that project.
  await openAddCodeFolders(page, 'Empty');
  await expect(add).toContainText('Adds a Git repository to Empty.');
});
