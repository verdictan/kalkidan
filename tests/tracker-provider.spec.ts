import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

/** Opens Project settings from the "Project actions" menu of the project header. */
async function openProjectSettings(page: Page) {
  await page.locator('.project-header').getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Project settings…', exact: true }).click();
}
/** Refreshes the board from the board menu. */
async function refreshBoard(page: Page) {
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Refresh/ }).click();
}

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
  await page.goto('/');
  // The empty overview offers a code folder first and an empty project second.
  await page
    .getByRole('main')
    .getByRole('button', { name: 'New empty project', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Platform');
  await dialog.getByRole('button', { name: 'More options', exact: true }).click();
  await expect(dialog).toContainText('Example Tracker board');
  await dialog.getByRole('button', { name: 'Connect now', exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect Example Tracker', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Create new', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Engineering roadmap', exact: true }).click();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // A new project opens on its overview. The board is on the Tasks page.
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(page.getByText('Provider-independent work', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeDisabled();
  const calls = await page.evaluate(() => (window as any).providerCalls);
  expect(calls).not.toContain('github');
  expect(calls).toContain('example:https://tracker.example/team');
});

test('project workflow mappings can be configured and reopened', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await page.getByRole('button', { name: 'Connect a board', exact: true }).click();
  const connect = page.getByRole('dialog');
  await connect.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await connect.getByRole('button', { name: 'Connect board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  // Automatic status changes are a part of Project settings › Board. A choice saves at once.
  await openProjectSettings(page);
  const workflow = page.getByRole('dialog', { name: 'Project settings: Atlas', exact: true });
  await workflow.getByRole('tab', { name: 'Board', exact: true }).click();
  const changes = workflow.getByRole('region', { name: 'Automatic status changes' });
  // A step with no saved status and no status of the default name does not move the task.
  const opened = changes.getByRole('combobox', { name: 'When a pull request opens' });
  await expect(opened).toContainText("Don't move");
  await opened.click();
  await page.getByRole('option', { name: 'In progress', exact: true }).click();
  await expect(page.getByText('Automatic status changes saved.', { exact: true })).toBeVisible();
  await workflow.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(workflow).not.toBeVisible();
  // Reopened, the section shows the saved choice.
  await openProjectSettings(page);
  await workflow.getByRole('tab', { name: 'Board', exact: true }).click();
  await expect(changes.getByRole('combobox', { name: 'When a pull request opens' })).toContainText(
    'In progress',
  );
});

test('board state is scoped to each project and survives panel remounts', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Record<string, number> = {};
    (window as any).boardCalls = calls;
    const groups = ['Alpha', 'Beta'].map((name) => ({
      id: name,
      name,
      repoIds: [],
      tracker: {
        provider: 'github',
        project: { id: name, title: name, url: `https://github.com/orgs/example/projects/${name}` },
      },
    }));
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
          id: 'github',
          name: 'GitHub',
          capabilities: {},
          statusNames: { progress: 'Doing', done: 'Done' },
        },
      ],
      trackerBoard: async (id: string) => {
        calls[id] = (calls[id] || 0) + 1;
        if ((window as any).failBoard) throw Error('Board unavailable');
        return {
          project: groups.find((group) => group.id === id)!.tracker.project,
          items: [{ id, title: `${id} task`, body: '' }],
        };
      },
    };
  });
  await page.goto('/');
  const tree = page.locator('.project-tree');
  await tree.getByRole('button', { name: 'Alpha', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Alpha task', exact: true })).toBeVisible();
  // The app also reads each connected board once for the overview. Count the reads from here.
  const before = await page.evaluate(() => ({ ...(window as any).boardCalls }));
  await tree.getByRole('button', { name: 'Beta', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Beta task', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alpha task', exact: true })).toHaveCount(0);
  await tree.getByRole('button', { name: 'Alpha', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Project page', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Alpha task', exact: true })).toBeVisible();
  // Going back to Alpha uses the board that is in memory. It does not read it again.
  expect((await page.evaluate(() => (window as any).boardCalls)).Alpha).toBe(before.Alpha);
  await page.evaluate(() => {
    (window as any).failBoard = true;
  });
  await refreshBoard(page);
  await expect(page.getByRole('alert')).toContainText('Board unavailable');
  await page.evaluate(() => {
    (window as any).failBoard = false;
  });
  await refreshBoard(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
