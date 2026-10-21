import { test, expect } from '@playwright/test';
test('GitHub settings require reload after an uncertain save and preserve permission gating', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
    const project = {
      id: 'P',
      title: 'Roadmap',
      owner: 'example',
      number: 1,
      url: 'https://github.com/orgs/example/projects/1',
    };
    const settings = {
      ...project,
      shortDescription: '',
      readme: '',
      public: false,
      closed: false,
      template: false,
      writable: true,
      repositories: [],
      revision: 'first',
    };
    let writes = 0;
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
          statusNames: {},
        },
      ],
      trackerBoard: async () => ({ project, writable: true, items: [], fields: [] }),
      trackerSettings: async () => structuredClone(settings),
      trackerSettingsUpdate: async (_id: string, _revision: string, action: any) => {
        (window as any).writes = ++writes;
        Object.assign(settings, action, { revision: 'second' });
        if (writes === 1) throw Error('The result is unknown.');
        settings.writable = false;
        return structuredClone(settings);
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
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'GitHub project settings…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Changed title');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('unknown');
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).writes)).toBe(1);
  await dialog.getByRole('button', { name: 'Reload settings' }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Changed title');
  await dialog.getByRole('button', { name: 'Use as a template' }).click();
  await expect(dialog.getByText('You have read-only access to this project.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});
