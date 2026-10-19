import { test, expect } from '@playwright/test';

test('remote project flow checks and installs the host, picks remote folders, and routes sessions remotely', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let host: any;
    const groups: any[] = [];
    const projects: any[] = [];
    const github = {
      id: 'gh',
      title: 'Roadmap',
      url: 'https://github.com/orgs/example/projects/1',
      owner: 'example',
      number: 1,
    };
    (window as any).calls = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects,
        groups,
        hosts: host ? [host] : [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      githubAuthStart: async () => ({ status: 'ready' }),
      githubAuthCancel: async () => ({}),
      githubOwners: async () => [],
      githubRepositories: async () => [],
      remoteHosts: async () => (host ? [host] : []),
      remoteAdd: async (name: string, target: string) =>
        (host = { id: 'h', name, target, status: 'disconnected' }),
      remoteCheck: async () =>
        (host = { ...host, status: 'checked', node: 'v22.23.0', platform: 'linux' }),
      remoteInstall: async () => (host = { ...host, status: 'connected', version: 'abc' }),
      createGroup: async (name: string, _url: string, hostId: string) => {
        groups.push({ id: 'g', name, hostId, github, repoIds: [] });
        return 'g';
      },
      githubBoard: async () => ({ project: github, items: [] }),
      remoteFolders: async () => ({
        path: '/home/dev',
        parent: '/home',
        folders: [{ name: 'web', path: '/home/dev/web' }],
      }),
      remoteAddRepository: async (group: string, path: string) => {
        projects.push({
          id: 'r',
          hostId: 'h',
          name: 'web',
          path,
          notes: '',
          favorite: false,
          addedAt: '',
        });
        groups[0].repoIds.push('r');
      },
      git: async () => null,
      remoteCall: async (hostId: string, method: string, args: any[]) => {
        (window as any).calls.push({ hostId, method, args });
        if (method === 'models') return [];
        if (method === 'chatCreate')
          return {
            id: 'run',
            sessionId: 'provider',
            status: 'completed',
            sessionReady: true,
            agent: 'codex',
            activity: '',
            messages: [{ id: 'm', role: 'assistant', text: 'Working on the remote host.' }],
          };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Remote platform');
  await dialog.getByRole('combobox', { name: 'Project execution host' }).click();
  await page.getByRole('option', { name: 'Remote SSH host', exact: true }).click();
  await dialog.getByLabel('Host name', { exact: true }).fill('Development');
  await dialog.getByLabel('SSH target', { exact: true }).fill('dev-server');
  await dialog.getByRole('button', { name: 'Save host', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Install Kalkidan helper and connect', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check connection', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Install Kalkidan helper and connect', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('Connected');
  await dialog.getByRole('button', { name: 'Use URL', exact: true }).click();
  await dialog.getByLabel('GitHub URL').fill('https://github.com/orgs/example/projects/1');
  await page.screenshot({ path: 'test-results/remote-project-setup.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add repositories to Remote platform', exact: true })
    .click();
  const add = page.getByRole('dialog', { name: 'Add repositories', exact: true });
  await add.getByRole('combobox', { name: 'Add to project' }).click();
  await page.getByRole('option', { name: 'Remote platform', exact: true }).click();
  await expect(add.getByRole('region', { name: 'Remote repository picker' })).toBeVisible();
  await add.getByLabel('Remote folder path').fill('/home/dev/web');
  await add.getByRole('button', { name: 'Add remote folder', exact: true }).click();
  await page.locator('.repo-select').click();
  await expect(page.getByText('SSH · Development · connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Codex session', exact: true }).click();
  await page.getByLabel('Message agent').fill('Inspect this repository');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Working on the remote host.', { exact: true })).toBeVisible();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.method === 'chatCreate'),
  );
  expect(call.hostId).toBe('h');
  expect(call.args[0]).toBe('/home/dev/web');
});
