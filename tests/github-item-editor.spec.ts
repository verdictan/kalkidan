import { test, expect } from '@playwright/test';
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
    .getByRole('group', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await page.getByRole('button', { name: 'Plan work', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Estimate', exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Save Estimate', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Permission changed');
  await expect(dialog.getByRole('spinbutton', { name: 'Estimate', exact: true })).toHaveValue('5');
  await dialog.getByRole('button', { name: 'Save Estimate', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Archive item', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Restore item', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore item', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Archive item', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('1 restricted items.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['g', 'I', 'estimate', { number: 5 }],
    ['g', 'I', 'estimate', { number: 5 }],
    { kind: 'archive' },
    { kind: 'unarchive' },
  ]);
});
