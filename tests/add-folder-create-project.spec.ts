import { test, expect } from '@playwright/test';
import { openAddCodeFolders } from './helpers/navigation';

test('a project created from Add code folders closes the flow and opens the new project', async ({
  page,
}) => {
  await page.goto('/');
  // An empty project shows "Add a code folder" on its overview.
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Empty');
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(create).not.toBeVisible();
  await page
    .getByRole('region', { name: 'Project tracker' })
    .getByRole('button', { name: 'Add a code folder', exact: true })
    .click();

  const add = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toContainText('Empty');
  await add.getByRole('button', { name: 'Create a new project', exact: true }).click();
  await expect(add).not.toBeVisible();
  await create.getByLabel('Project name', { exact: true }).fill('Mobile');
  await create.getByRole('button', { name: 'Choose code folder', exact: true }).click();
  const found = page.getByRole('dialog', { name: /^Found \d+ Git repositories/ });
  await found.getByRole('button', { name: 'Select none', exact: true }).click();
  await found.getByRole('checkbox', { disabled: false }).first().check();
  await found.getByRole('button', { name: 'Add 1 code folder', exact: true }).click();
  await create.getByRole('button', { name: 'Create project', exact: true }).click();

  await expect(create).not.toBeVisible();
  // The flow is complete. The Add code folders dialog does not open again.
  await expect(page.getByText('Created Mobile with 1 code folder.').first()).toBeAttached();
  await page.waitForTimeout(300);
  await expect(add).not.toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Created Mobile with 1 code folder' }),
  ).toBeVisible();
  // The new project shows.
  await expect(page.getByRole('main').getByRole('heading', { name: 'Mobile' })).toBeVisible();

  // The dialog of another project still adds to that project.
  await openAddCodeFolders(page, 'Empty');
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toContainText('Empty');
});

test('canceling New project returns to Add code folders with the same project', async ({
  page,
}) => {
  await page.goto('/');
  await openAddCodeFolders(page, 'Atlas');
  const add = page.getByRole('dialog', { name: 'Add code folders', exact: true });
  await add.getByRole('button', { name: 'Create a new project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toContainText('Atlas');
});
