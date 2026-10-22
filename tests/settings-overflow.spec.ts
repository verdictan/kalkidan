import type { Locator } from '@playwright/test';
import { test, expect, openComputersPage, openPreferences } from './helpers/app';

const longPath =
  '/Users/someone/.vscode/extensions/openai.chatgpt-26.1007.21434-darwin-arm64/bin/macos-aarch64/codex';

test('Preferences and Computers have no horizontal overflow and long paths truncate in the middle', async ({
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
  // From 900px wide, the sidebar starts open. The Computers page shows beside it.
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  const computers = await openComputersPage(page);
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
  // "Choose…" opens the programs of this computer with the program paths.
  await computers.getByRole('button', { name: 'Choose the Codex program' }).click();
  const programs = page.getByRole('dialog', { name: 'Coding agent programs on this computer' });
  const shown = programs.getByLabel(longPath, { exact: true });
  await expect(shown).toBeVisible();
  // The end of the path (the program name) stays visible.
  await expect(shown).toContainText('macos-aarch64/codex');
  expect(await overflowOf(programs), 'programs').toEqual({
    scroll: 0,
    wide: [],
  });
  await programs.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(programs).toHaveCount(0);

  const preferences = await openPreferences(page);
  expect(await overflowOf(page.locator('.preferences-body')), 'Preferences').toEqual({
    scroll: 0,
    wide: [],
  });
  expect(await overflowOf(preferences), 'Preferences dialog').toEqual({ scroll: 0, wide: [] });
});
