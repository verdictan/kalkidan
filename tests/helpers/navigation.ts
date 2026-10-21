import type { Page } from '@playwright/test';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Opens a code folder page. The sidebar shows projects and chats only, so the test opens the
 * project overview and selects the code folder there. Without a name, it opens the first code
 * folder of the first project that has one.
 */
export async function openCodeFolder(page: Page, name?: string) {
  const projects = page.locator('.project-tree .project-select');
  await projects.first().waitFor();
  const count = await projects.count();
  for (let index = 0; index < count; index++) {
    await projects.nth(index).click();
    const rows = page.locator('.project-home-open');
    const row = name
      ? rows.filter({
          has: page.locator('.project-home-title', { hasText: new RegExp(`^${escape(name)}$`) }),
        })
      : rows;
    try {
      await row.first().waitFor({ timeout: count > 1 ? 3000 : 10000 });
    } catch {
      continue;
    }
    await row.first().click();
    return;
  }
  throw new Error(`No project shows the code folder ${name || ''}`.trim());
}

/**
 * Opens a tab of a project page, such as Docs or Memory. Without a project name, it uses the
 * project that shows, or else the first project in the sidebar.
 */
export async function openProjectTab(page: Page, tab: string, project?: string) {
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  if (project || !(await tabs.isVisible())) {
    const row = project
      ? page.locator('.project-tree').getByRole('button', { name: project, exact: true })
      : page.locator('.project-tree .project-select').first();
    await row.click();
  }
  await tabs.getByRole('button', { name: tab, exact: true }).click();
}

/** Opens the Add code folders dialog of a project from its row menu in the sidebar. */
export async function openAddCodeFolders(page: Page, project: string) {
  await page.getByRole('button', { name: `Manage project ${project}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add a code folder…', exact: true }).click();
}
