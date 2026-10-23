import { test, expect } from './helpers/app';

test('a project created with a code folder closes the flow and opens the new project', async ({
  page,
}) => {
  await page.goto('/');
  // New project adds its code folder in the same dialog. Every Git repository in the chosen
  // folder is added: there is no list of found repositories to confirm.
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'New project', exact: true });
  await create.getByLabel('Project name', { exact: true }).fill('Mobile');
  await create.getByRole('button', { name: 'Add code folder…', exact: true }).click();
  await expect(create).toContainText('3 code folders from atlas');
  await expect(page.getByRole('dialog', { name: /^Found \d+ Git repositories/ })).toHaveCount(0);
  await create.getByRole('button', { name: 'Create project', exact: true }).click();

  await expect(create).not.toBeVisible();
  // The flow is complete. No other dialog opens, and a success needs no toast.
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The new project shows with its repos (code folders). The last item of the list is "Add
  // repo…".
  await expect(page.getByRole('main').getByRole('heading', { name: 'Mobile' })).toBeVisible();
  const folders = page.getByRole('region', { name: 'Repos', exact: true });
  await expect(folders.getByRole('listitem')).toHaveCount(4);

  // "Add repo…" of a local project opens the folder picker at once, with no dialog. The
  // preview picker chooses the same folder again, so nothing new is added and a toast says so.
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  await create.getByLabel('Project name', { exact: true }).fill('Empty');
  await create.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Empty' })).toBeVisible();
  await folders.getByRole('button', { name: 'Add repo…', exact: true }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Every Git repository in atlas is already in Kalkidan.' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(folders.getByRole('listitem')).toHaveCount(1);
});
