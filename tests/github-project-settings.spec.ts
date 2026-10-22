import { test, expect } from './helpers/app';
test('Board settings opens Settings › project › Board and links to the GitHub project settings', async ({
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
      // The desktop API has these. Kalkidan must not call the settings update.
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
  // Board settings… in the board menu opens the project section of Settings at its Board group.
  await page.getByRole('button', { name: 'Board: Roadmap #1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Board settings…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(
    dialog
      .getByRole('tablist', { name: 'Settings sections' })
      .getByRole('tab', { name: 'Platform', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  const board = dialog.getByRole('region', { name: 'Board', exact: true });
  await expect(board).toBeFocused();
  await expect(board.getByRole('list', { name: 'Connected board' })).toContainText('Roadmap');
  // Kalkidan does not edit the GitHub project. Its settings open on GitHub.
  await board.getByRole('button', { name: 'Open on GitHub', exact: true }).click();
  const github = page.getByRole('menu');
  await expect(github.getByRole('menuitem', { name: /^Fields/ })).toHaveAttribute(
    'href',
    'https://github.com/orgs/example/projects/1/settings',
  );
  await expect(github.getByRole('menuitem', { name: /^Workflows/ })).toHaveAttribute(
    'href',
    'https://github.com/orgs/example/projects/1/workflows',
  );
  await expect(github.getByRole('menuitem', { name: /^Board/ })).toHaveAttribute(
    'href',
    'https://github.com/orgs/example/projects/1',
  );
  await expect(github.getByRole('menuitem', { name: /^Views/ })).toBeVisible();
  await expect(github.getByRole('menuitem', { name: /^Status updates/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(github).toHaveCount(0);
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).writes)).toBeUndefined();
});
