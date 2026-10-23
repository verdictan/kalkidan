import type { Page } from '@playwright/test';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The project rows of the sidebar tree. */
const projectRows = (page: Page) => page.locator('.tree-row[data-kind="project"]');

/** Expands a tree row (project or repo) when it is collapsed. */
async function expandRow(row: ReturnType<Page['locator']>) {
  const toggle = row.locator('.tree-toggle');
  if ((await toggle.count()) && /^Expand /.test((await toggle.getAttribute('aria-label')) || ''))
    await toggle.click();
}

/**
 * Shows a repo (code folder) in the sidebar tree: it opens the project Overview, then expands
 * the project and the repo, so the repo's sessions show. Without a name, it uses the first repo
 * of the first project that has one.
 */
export async function openCodeFolder(page: Page, name?: string) {
  const projects = projectRows(page);
  await projects.first().waitFor();
  const count = await projects.count();
  for (let index = 0; index < count; index++) {
    const project = projects.nth(index);
    await project.locator('.tree-row-button').click();
    await expandRow(project);
    const repos = page.locator('.tree-row[data-kind="repo"]');
    const repo = name
      ? repos.filter({
          has: page.locator('.tree-label', { hasText: new RegExp(`^${escape(name)}$`) }),
        })
      : repos;
    try {
      await repo.first().waitFor({ timeout: count > 1 ? 3000 : 10000 });
    } catch {
      continue;
    }
    await expandRow(repo.first());
    return;
  }
  throw new Error(`No project shows the code folder ${name || ''}`.trim());
}

/** Opens a session (chat) from the sidebar tree by its title. */
export async function openTreeChat(page: Page, title: string) {
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: `Chat: ${title}`, exact: true })
    .click();
}

/**
 * Opens a view of a project page: Overview, Tasks or Knowledge (Docs and Memory are parts of
 * Knowledge). Without a project name, it uses the project that shows, or the first project.
 */
export async function openProjectTab(page: Page, tab: string, project?: string) {
  const tabs = page.getByRole('navigation', { name: 'Project page' });
  if (project || !(await tabs.isVisible())) {
    const row = project
      ? projectRows(page).filter({
          has: page.locator('.tree-label', { hasText: new RegExp(`^${escape(project)}$`) }),
        })
      : projectRows(page);
    await row.first().locator('.tree-row-button').click();
  }
  const section = { Docs: 'pages', Memory: 'memory' }[tab];
  await tabs.getByRole('button', { name: section ? 'Knowledge' : tab, exact: true }).click();
  if (section === 'memory') await page.getByRole('button', { name: 'Memory', exact: true }).click();
}

/** Opens Add repo for a project from its right-click menu in the sidebar tree. */
export async function openAddCodeFolders(page: Page, project: string) {
  await projectRows(page)
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${escape(project)}$`) }) })
    .first()
    .locator('.tree-row-button')
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add repo…', exact: true }).click();
}

/**
 * Opens the Clone from GitHub dialog for a project from the command palette. "Add code folder…"
 * of a local project opens the folder picker at once, so the clone has its own palette action.
 */
export async function openCloneFromGitHub(page: Page, project: string) {
  await page.locator('.project-tree').getByRole('button', { name: project, exact: true }).click();
  await page.getByRole('button', { name: 'Search or run a command', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Search or run a command', exact: true });
  await palette
    .getByRole('combobox', { name: 'Search or run a command' })
    .fill('Clone from GitHub');
  await palette.getByRole('option', { name: 'Clone from GitHub…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Clone from GitHub', exact: true }).waitFor();
}

/**
 * Opens the New project dialog through ⌘K. Before the first project there is no sidebar
 * (ST-C2), so ⌘K and ⇧⌘N are the ways to make a project.
 */
export async function openNewProject(page: Page) {
  await page.getByRole('heading', { name: 'What are we working on?' }).waitFor();
  await page.keyboard.press('ControlOrMeta+KeyK');
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette.getByRole('combobox', { name: 'Search or run a command' }).fill('New project');
  await palette
    .getByRole('option', { name: /^New project…/ })
    .first()
    .click();
}
