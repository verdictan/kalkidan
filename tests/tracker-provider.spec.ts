import { test, expect } from '@playwright/test';

test('a configured non-GitHub provider drives project creation and a read-only board', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // An empty workspace opens the first-run onboarding. This test does not use it.
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
    const project = {
      id: 'board',
      title: 'Engineering roadmap',
      url: 'https://tracker.example/team',
    };
    const groups: any[] = [];
    const calls: string[] = [];
    (window as any).providerCalls = calls;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups,
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [
        {
          id: 'example',
          name: 'Example Tracker',
          capabilities: {
            createProject: false,
            createItem: false,
            importItem: false,
            updateStatus: false,
          },
          statusNames: { progress: 'Building', done: 'Released' },
        },
      ],
      trackerAuthStart: async (provider: string) => {
        calls.push(provider);
        return { status: 'ready' };
      },
      trackerAuthCancel: async () => ({ status: 'idle' }),
      trackerOwners: async () => [{ id: 'team', login: 'Engineering', kind: 'team' }],
      trackerProjects: async () => [project],
      trackerBoard: async () => ({
        project,
        items: [{ id: 'task', title: 'Provider-independent work', body: '', statusId: 'queued' }],
        statusField: { id: 'workflow', options: [{ id: 'queued', name: 'Queued' }] },
      }),
      createGroup: async (
        name: string,
        reference: string,
        host: string | undefined,
        provider: string,
      ) => {
        calls.push(provider + ':' + reference);
        groups.push({ id: 'g', name, repoIds: [], tracker: { provider, project } });
        return 'g';
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
  await expect(dialog).toContainText('Example Tracker');
  await dialog.getByLabel('Project name', { exact: true }).fill('Platform');
  await dialog.getByRole('button', { name: 'Connect Example Tracker', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create new', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Engineering roadmap', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Provider-independent work', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeDisabled();
  const calls = await page.evaluate(() => (window as any).providerCalls);
  expect(calls).not.toContain('github');
  expect(calls).toContain('example:https://tracker.example/team');
});

test('project workflow mappings can be configured and reopened', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  const connect = page.getByRole('dialog');
  await connect.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await connect.getByRole('button', { name: 'Connect project', exact: true }).click();
  await page.getByRole('button', { name: 'Tracker actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Workflow', exact: true }).click();
  const workflow = page.getByRole('dialog', { name: 'Task workflow', exact: true });
  await workflow.getByRole('combobox', { name: 'Status when work starts' }).click();
  await page.getByRole('option', { name: 'In progress', exact: true }).click();
  await workflow.getByRole('button', { name: 'Save workflow' }).click();
  await expect(workflow).not.toBeVisible();
  await page.getByRole('button', { name: 'Tracker actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Workflow', exact: true }).click();
  await expect(workflow.getByRole('combobox', { name: 'Status when work starts' })).toContainText(
    'In progress',
  );
});
