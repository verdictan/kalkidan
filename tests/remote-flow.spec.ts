import { test, expect, newChat } from './helpers/app';
import { openCodeFolder, openAddCodeFolders } from './helpers/navigation';

test('remote project flow checks and installs the host, picks remote folders, and routes sessions remotely', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // An empty workspace opens the first-run onboarding. This test does not use it.
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
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
      remoteFolders: async (_host: string, value: string) => {
        if (value === '/mnt/work/')
          throw Error("ENOENT: no such file or directory, realpath '/mnt/work/'");
        const path = value === '~' ? '/home/dev' : value;
        return {
          path,
          parent: path === '/mnt' ? '/' : '/home',
          folders:
            path === '/mnt'
              ? [{ name: 'Work', path: '/mnt/Work' }]
              : [{ name: 'web', path: '/home/dev/web' }],
        };
      },
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
  await page.goto('/');
  // The Projects root of the tree always has "New project". A remote project starts empty.
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'New project', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Remote platform');
  await dialog.getByRole('button', { name: 'More options', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Project execution host' }).click();
  await page.getByRole('option', { name: 'Remote SSH host', exact: true }).click();
  await dialog.getByLabel('Host name', { exact: true }).fill('Development');
  await dialog.getByLabel('SSH target', { exact: true }).fill('dev-server');
  await dialog.getByRole('button', { name: 'Save host', exact: true }).click();
  // Saving checks the host. The helper is missing, so the dialog asks before it installs it.
  await dialog
    .getByRole('button', { name: 'Install the Kalkidan helper and connect', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('Connected');
  await dialog.getByRole('button', { name: 'Connect now', exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect GitHub', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use URL', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: 'Board URL', exact: true })
    .fill('https://github.com/orgs/example/projects/1');
  await page.screenshot({ path: 'test-results/remote-project-setup.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await openAddCodeFolders(page, 'Remote platform');
  const add = page.getByRole('dialog', { name: 'Add code folder', exact: true });
  // The project is known, so the dialog has no project field.
  await expect(add).toContainText('Remote platform');
  await expect(add.getByRole('combobox', { name: 'Add to project' })).toHaveCount(0);
  await expect(add.getByRole('region', { name: 'Remote repository picker' })).toBeVisible();
  await add.getByLabel('Remote folder path').fill('/mnt/work/');
  await expect(add.getByRole('button', { name: 'Add remote folder', exact: true })).toBeDisabled();
  await add.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(add.getByRole('alert')).toContainText('Check the spelling and letter case');
  await expect(add.getByRole('button', { name: 'Add remote folder', exact: true })).toBeDisabled();
  await add.getByRole('button', { name: 'Parent folder', exact: true }).click();
  await expect(add.getByLabel('Remote folder path')).toHaveValue('/mnt');
  await expect(add.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
  await add.getByRole('button', { name: 'Home', exact: true }).click();
  await add.getByRole('button', { name: 'web', exact: true }).click();
  await expect(add.getByLabel('Remote folder path')).toHaveValue('/home/dev/web');
  await add.getByRole('button', { name: 'Add remote folder', exact: true }).click();
  await openCodeFolder(page);
  await expect(page.getByText(/^SSH · Development · connected/)).toBeVisible();
  await newChat(page);
  await page.getByLabel('Message agent').fill('Inspect this repository');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Working on the remote host.', { exact: true })).toBeVisible();
  const call = await page.evaluate(() =>
    (window as any).calls.find((c: any) => c.method === 'chatCreate'),
  );
  expect(call.hostId).toBe('h');
  expect(call.args[0]).toBe('/home/dev/web');
});
