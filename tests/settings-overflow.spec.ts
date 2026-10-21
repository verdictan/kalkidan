import { test, expect } from '@playwright/test';

const longPath =
  '/Users/someone/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex';

test('Settings tabs have no horizontal overflow and long paths truncate in the middle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1080, height: 715 });
  await page.addInitScript((path) => {
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      trackerProviders: async () => [],
      remoteHosts: async () => [],
      githubCliCheck: async () => ({ status: 'ready' }),
      githubAuthStatus: async () => ({ status: 'idle' }),
      agentInstallations: async () => [
        { agent: 'codex', status: 'installed', version: '0.200.0', path },
        { agent: 'claude', status: 'installed', version: '2.5.0', path: path + '-claude' },
      ],
    };
  }, longPath);
  await page.goto('/');
  // Below 1100px wide, the sidebar starts closed.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Settings', exact: true });
  // The sidebar stays open next to the Settings page. It makes the page narrow.
  await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
  const shown = dialog.getByLabel(longPath, { exact: true });
  await expect(shown).toBeVisible();
  // The end of the path (the program name) stays visible.
  await expect(shown).toContainText('macos-aarch64/codex');

  const tabs = await dialog.getByRole('tab').allTextContents();
  expect(tabs.length).toBeGreaterThan(3);
  for (const name of tabs) {
    await dialog.getByRole('tab', { name, exact: true }).click();
    const overflow = await page.locator('.management-pane').evaluate((pane) => {
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
    expect(overflow, name).toEqual({ scroll: 0, wide: [] });
  }
});
