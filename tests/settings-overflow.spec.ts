import { test, expect, openSettingsWindow } from './helpers/app';

const longPath =
  '/Users/someone/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex';
const longHost = 'build-server-with-a-very-long-name-in-the-eu-central-region-0042';

test('Settings has no horizontal overflow with long names and paths', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 715 });
  await page.addInitScript(
    ({ path, host }) => {
      const tool = (id: string, name: string, version: string) => ({
        tool: id,
        name,
        kind: id === 'gh' ? 'github' : 'agent',
        state: 'ready',
        installed: true,
        version,
        path: path + '-' + id,
        signedIn: 'yes',
        account: id === 'gh' ? 'someone-with-a-long-github-user-name' : undefined,
        access: 'granted',
        usable: id !== 'gh',
        installUrl: `https://example.com/${id}`,
      });
      const tools = [
        tool('codex', 'Codex', '0.200.0-alpha.10.2'),
        tool('claude', 'Claude Code', '2.5.0'),
        tool('gh', 'GitHub CLI', '2.62.0'),
      ];
      (window as any).workspace = {
        snapshot: async () => ({
          projects: [
            {
              id: 'p1',
              name: 'a-repository-with-a-long-name-for-the-chip',
              path: path,
              favorite: false,
              notes: '',
              addedAt: '',
            },
          ],
          groups: [{ id: 'g', name: 'A project with a long name', repoIds: ['p1'] }],
          sessions: [],
          warnings: [],
          platform: 'darwin',
        }),
        trackerProviders: async () => [],
        remoteHosts: async () => [
          { id: 'h1', name: host, target: `someone@${host}.example.com`, status: 'connected' },
        ],
        githubCliCheck: async () => ({ status: 'ready' }),
        githubAuthStatus: async () => ({ status: 'idle' }),
        computerTools: async () => [
          { computer: 'local', name: 'This Mac', connected: true, checkedAt: '', tools },
          { computer: 'h1', name: host, connected: true, checkedAt: '', tools },
        ],
        proxySignIns: async () => [{ proxy: `${host}.example.com:3128`, username: 'someone' }],
      };
    },
    { path: longPath, host: longHost },
  );
  await page.goto('/');
  // From 900px wide, the sidebar starts open. The Settings sheet shows over it.
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  const settings = await openSettingsWindow(page, 'Tools');
  await expect(settings.getByRole('list', { name: longHost, exact: true })).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Proxy sign-in' })).toBeVisible();
  await expect(
    settings.getByRole('region', { name: 'A project with a long name', exact: true }),
  ).toBeVisible();
  // The path of a tool is its tooltip, not text in the row.
  await expect(settings).not.toContainText(longPath);
  await expect(settings.getByRole('listitem', { name: longPath + '-codex' }).first()).toBeVisible();
  // The sheet and the body that scrolls it fit in the window.
  const frame = page.locator('.st-sheet-body');
  const overflow = await frame.evaluate((pane) => {
    const right = pane.getBoundingClientRect().right;
    const wide = [...pane.querySelectorAll<HTMLElement>('*')].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.right > right + 1;
    });
    return {
      scroll: pane.scrollWidth - pane.clientWidth,
      wide: wide.slice(0, 3).map((node) => node.outerHTML.slice(0, 120)),
    };
  });
  expect(overflow).toEqual({ scroll: 0, wide: [] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
