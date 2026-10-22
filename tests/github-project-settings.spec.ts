import { test, expect } from './helpers/app';
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
      // The desktop API has both. Board settings needs the resources for its Fields tab.
      trackerResources: async (_g: string, kind: string) => ({
        projectId: 'P',
        kind,
        revision: 'resources',
        writable: true,
        records: [],
      }),
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
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  // The GitHub project settings are in Board settings, from the board toolbar.
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Board settings' });
  await dialog.getByRole('tab', { name: 'GitHub project' }).click();
  await expect(dialog.getByRole('tab', { name: 'GitHub project' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Text saves when the user presses Enter or leaves the field.
  await dialog.getByLabel('Title', { exact: true }).fill('Changed title');
  await dialog.getByLabel('Title', { exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('unknown');
  // After a failed save, the dialog loads the current settings again by itself.
  await expect(dialog.getByRole('alert')).toContainText('Kalkidan loaded the current settings.');
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Changed title');
  expect(await page.evaluate(() => (window as any).writes)).toBe(1);
  // A switch saves at once.
  await dialog.getByRole('switch', { name: 'Use as a template' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).writes)).toBe(2);
  await expect(dialog.getByText('You have read-only access to this project.')).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(dialog.getByRole('switch', { name: 'Use as a template' })).toBeDisabled();
});
