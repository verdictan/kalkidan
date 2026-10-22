import type { Locator } from '@playwright/test';
import { test, expect, openSettingsWindow, settingsSection } from './helpers/app';

const longPath =
  '/Users/someone/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex';

test('Settings has no horizontal overflow and long paths truncate in the middle', async ({
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
  // From 900px wide, the sidebar starts open. Settings opens over it.
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  const settings = await openSettingsWindow(page, 'Computers');
  const computers = settings.getByRole('tabpanel', { name: 'Computers', exact: true });
  /** The horizontal overflow of an element: its scroll width and the children past its edge. */
  const overflowOf = (pane: Locator) =>
    pane.evaluate((pane) => {
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
  await expect(computers.getByRole('group', { name: 'Codex', exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await overflowOf(computers), 'Computers').toEqual({ scroll: 0, wide: [] });
  // Details › "Programs…" opens the coding agent programs of this computer with their paths.
  await computers.getByRole('button', { name: 'Details', exact: true }).click();
  await computers.getByRole('button', { name: 'Programs…' }).click();
  const programs = page.getByRole('dialog', { name: 'Coding agent programs on this computer' });
  const shown = programs.getByLabel(longPath, { exact: true });
  await expect(shown).toBeVisible();
  // The end of the path (the program name) stays visible.
  await expect(shown).toContainText('macos-aarch64/codex');
  expect(await overflowOf(programs), 'programs').toEqual({
    scroll: 0,
    wide: [],
  });
  await page.keyboard.press('Escape');
  await expect(programs).toHaveCount(0);

  // Each section of Settings fits in the window.
  for (const section of ['General', 'Computers', 'Account', 'Project']) {
    await settingsSection(page, section).click();
    const panel = settings.getByRole('tabpanel', { name: section, exact: true });
    await expect(panel).toBeVisible();
    expect(await overflowOf(panel), `Settings › ${section}`).toEqual({ scroll: 0, wide: [] });
    expect(await overflowOf(settings), `Settings window › ${section}`).toEqual({
      scroll: 0,
      wide: [],
    });
  }
});
