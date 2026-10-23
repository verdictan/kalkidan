import { test, expect } from './helpers/app';
test('GitHub inspector edits fields, retains a failed draft, and restores archived items', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
    const project = {
      id: 'P',
      title: 'Roadmap',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    };
    const item: any = {
      id: 'I',
      title: 'Plan work',
      body: 'Description',
      kind: 'DraftIssue',
      fieldValues: [],
      archived: false,
    };
    let fail = true;
    const calls: any[] = [];
    (window as any).calls = calls;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'g', name: 'Platform', repoIds: [], tracker: { provider: 'github', project } },
        ],
      }),
      trackerProviders: async () => [
        {
          id: 'github',
          name: 'GitHub',
          capabilities: { createItem: true, updateStatus: true },
          statusNames: { progress: 'Doing', done: 'Done' },
        },
      ],
      trackerBoard: async () => ({
        project,
        writable: true,
        items: item.archived ? [] : [structuredClone(item)],
        archivedItems: item.archived ? [structuredClone(item)] : [],
        restrictedItems: 1,
        fields: [
          { id: 'estimate', name: 'Estimate', dataType: 'NUMBER', raw: {} },
          { id: 'target', name: 'Target date', dataType: 'DATE', raw: {} },
        ],
      }),
      trackerField: async (g: string, i: string, f: string, value: any) => {
        calls.push([g, i, f, value]);
        if (fail) {
          fail = false;
          throw Error('Permission changed. Refresh and retry.');
        }
        item.fieldValues = [{ field: { id: f }, ...value }];
      },
      trackerItemAction: async (_g: string, _i: string, action: any) => {
        calls.push(action);
        item.archived = action.kind === 'archive';
      },
    };
  });
  await page.goto('/');
  await page
    .locator('.project-tree')
    .getByRole('button', { name: 'Platform', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await page.getByRole('button', { name: 'Plan work', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // The GitHub fields are pills under the title. "Set a field" sets an empty field.
  await dialog.getByRole('button', { name: 'Set a field', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Estimate…', exact: true }).click();
  const estimate = page
    .getByRole('dialog', { name: 'Estimate', exact: true })
    .getByRole('spinbutton', { name: 'Estimate', exact: true });
  // Fields save on Enter. A failed write keeps the value, so Enter tries again.
  await estimate.fill('5');
  await estimate.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Permission changed');
  await expect(estimate).toHaveValue('5');
  await estimate.press('Enter');
  await expect(estimate).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Estimate: 5', exact: true })).toBeVisible();
  const actions = dialog.getByRole('button', { name: 'Task actions', exact: true });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Archive item', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.length)).toBe(3);
  await actions.click();
  await page.getByRole('menuitem', { name: 'Restore item', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).calls.length)).toBe(4);
  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'Archive item', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The board health line tells how many tasks the user cannot see.
  await expect(page.getByRole('toolbar', { name: 'Task tools' })).toContainText('1 Hidden');
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['g', 'I', 'estimate', { number: 5 }],
    ['g', 'I', 'estimate', { number: 5 }],
    { kind: 'archive' },
    { kind: 'unarchive' },
  ]);
});
