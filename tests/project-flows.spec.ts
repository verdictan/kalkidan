import { test, expect } from '@playwright/test';
const url = '/';
test('single view ignores old split preferences and preserves conversation drafts while navigating', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('kalkidan.layout', 'split'));
  await page.goto(url);
  await expect(page.getByRole('region', { name: 'Project overview', exact: true })).toBeVisible();
  await page.locator('.repo-select').filter({ hasText: 'atlas-web' }).click();
  await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
  await page.getByLabel('Message agent').fill('Preserve this draft');
  await expect(page.getByRole('combobox', { name: 'Content layout' })).toHaveCount(0);
  await expect(page.locator('.split-view, .repo-breadcrumb, .conversation-breadcrumb')).toHaveCount(
    0,
  );
  await expect(page.locator('.management-pane')).toBeHidden();
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Message agent')).toBeHidden();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue('Preserve this draft');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue('Preserve this draft');
  await page.setViewportSize({ width: 980, height: 680 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('adding a repository requires choosing a project', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Add code folders to Atlas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Local folder', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Add to project' }).click();
  await page.getByRole('option', { name: 'Choose a project', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Choose folder', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: 'Add to project' }).click();
  await expect(page.getByRole('option', { name: 'Ungrouped', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Atlas', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Choose folder', exact: true })).toBeEnabled();
});

test('dragging a task syncs its status and a failed write keeps the original column', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const project = { id: 'gh', title: 'Roadmap', owner: 'org', number: 1, url: '' };
    let statusId = 'todo';
    (window as any).writes = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Platform', repoIds: [], github: project }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      githubAuthCancel: async () => ({ status: 'idle' }),
      githubBoard: async () => ({
        project,
        statusField: {
          id: 's',
          options: [
            { id: 'todo', name: 'Todo' },
            { id: 'progress', name: 'In progress' },
            { id: 'done', name: 'Done' },
          ],
        },
        items: [{ id: 'task', title: 'Drag this task', body: 'Details', statusId }],
      }),
      githubStatus: async (_group: string, _item: string, option: string) => {
        (window as any).writes.push(option);
        if (option === 'done') throw new Error('GitHub temporarily unavailable');
        statusId = option;
      },
    };
  });
  await page.goto(url);
  // The project row opens the overview. The Tasks row opens the board.
  await page.locator('.project-tree').getByRole('button', { name: 'Tasks', exact: true }).click();
  const card = page.locator('[draggable="true"]');
  await card.dragTo(page.getByRole('region', { name: 'In progress column', exact: true }), {
    sourcePosition: { x: 4, y: 4 },
    targetPosition: { x: 50, y: 20 },
  });
  await expect(page.getByRole('region', { name: 'In progress column', exact: true })).toContainText(
    'Drag this task',
  );
  await card.dragTo(page.getByRole('region', { name: 'Done column', exact: true }), {
    sourcePosition: { x: 4, y: 4 },
    targetPosition: { x: 50, y: 20 },
  });
  await expect(page.getByRole('alert')).toContainText('GitHub temporarily unavailable');
  await expect(page.getByRole('region', { name: 'In progress column', exact: true })).toContainText(
    'Drag this task',
  );
  expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress', 'done']);
});

for (const outcome of ['completed', 'failed', 'stopped']) {
  test(`linked task ${outcome}: starts In progress and completion requires explicit review`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ outcome }) => {
        const project = { id: 'gh', title: 'Roadmap', owner: 'org', number: 1, url: '' };
        const session = {
          id: 's',
          agent: 'codex',
          title: 'Linked conversation',
          cwd: '/tmp/repo',
          updatedAt: new Date().toISOString(),
          organization: { taskId: 'task' },
        };
        let statusId = 'todo';
        let run: any;
        (window as any).writes = [];
        (window as any).workspace = {
          snapshot: async () => ({
            projects: [
              { id: 'r', name: 'Repo', path: '/tmp/repo', notes: '', favorite: false, addedAt: '' },
            ],
            groups: [{ id: 'g', name: 'Platform', repoIds: ['r'], github: project }],
            sessions: [session],
            warnings: [],
            platform: 'darwin',
          }),
          git: async () => null,
          transcript: async () => ({ messages: [], truncated: false }),
          githubBoard: async () => ({
            project,
            statusField: {
              id: 's',
              options: [
                { id: 'todo', name: 'Todo' },
                { id: 'progress', name: 'In progress' },
                { id: 'done', name: 'Done' },
              ],
            },
            items: [{ id: 'task', title: 'Implement feature', body: '', statusId }],
          }),
          githubStatus: async (_group: string, _item: string, option: string) => {
            statusId = option;
            (window as any).writes.push(option);
          },
          chatStart: async () => {
            run = {
              id: 'run',
              agent: 'codex',
              sessionId: 's',
              sessionReady: true,
              status: 'running',
              messages: [],
              activity: 'Working',
            };
            return run;
          },
          chatStatus: async () => ({
            ...run,
            status: outcome,
            ...(outcome === 'failed' ? { error: 'Agent failed' } : {}),
            messages: [{ id: 'a', role: 'assistant', text: 'Response ended' }],
          }),
        };
      },
      { outcome },
    );
    await page.goto(url);
    await page.locator('.repo-select').click();
    await page.getByRole('button', { name: 'Resume Linked conversation', exact: true }).click();
    await page.getByLabel('Message agent').fill('Implement the feature');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Response ended', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress']);
    if (outcome === 'completed') {
      await expect(page.getByRole('button', { name: 'Mark task done', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('button', { name: 'Review task completion', exact: true }).click();
      await expect(page.getByText('Complete this task?', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Mark task done', exact: true }).click();
      await expect(page.getByText('Task marked Done.', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).writes)).toEqual(['progress', 'done']);
    } else
      await expect(page.getByRole('button', { name: 'Mark task done', exact: true })).toHaveCount(
        0,
      );
  });
}

test('navigation collapse preserves the conversation and command K restores search', async ({
  page,
}) => {
  await page.goto(url);
  await page.locator('.repo-select').filter({ hasText: 'atlas-web' }).click();
  await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
  await expect(page.getByText('What are we working on?', { exact: true })).toBeVisible();
  await page.getByLabel('Message agent').fill('Keep this draft while I focus');
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Projects and repositories' }),
  ).not.toBeVisible();
  await expect(page.getByLabel('Message agent')).toHaveValue('Keep this draft while I focus');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByLabel('Search projects and chats')).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Projects and repositories' })).toBeVisible();
  await page.screenshot({ path: 'test-results/chatgpt-new-conversation.png', fullPage: true });
  await page.setViewportSize({ width: 980, height: 680 });
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('settings shows agent and remote controls without history import', async ({ page }) => {
  await page.setViewportSize({ width: 773, height: 988 });
  await page.goto(url);
  // Below 1100px wide, the sidebar starts closed.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'General' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Agents on this computer' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'GitHub account' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Remote hosts' }).click();
  await expect(dialog.getByRole('button', { name: 'Add host', exact: true })).toBeVisible();
  await expect(dialog.getByText('Import chat history', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Preview chat history' })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'General' }).click();
  await expect(dialog.getByRole('group', { name: 'Appearance' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/settings-modal.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('project menu connects the chosen project without duplicate authorization', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).authStarts = 0;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: [
          { id: 'a', name: 'Atlas', repoIds: [] },
          { id: 'b', name: 'Platform', repoIds: [] },
        ],
      }),
      githubAuthStart: async () => {
        (window as any).authStarts++;
        return { status: 'waiting', code: 'ABCD-1234' };
      },
      githubAuthCancel: async () => ({}),
      githubAuthStatus: async () => ({ status: 'waiting', code: 'ABCD-1234' }),
    };
  });
  await page.goto(url);
  await expect(page.getByRole('combobox', { name: 'Tracker connection project' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Projects and repositories' })
    .getByRole('button', { name: 'Platform', exact: true })
    .click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Connect a GitHub Projects board…', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Connect a GitHub Projects board', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('GitHub device code')).toHaveValue('ABCD-1234');
  expect(await page.evaluate(() => (window as any).authStarts)).toBe(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Platform', exact: true })).toBeVisible();
});

test('task conversation returns to the filtered project board', async ({ page }) => {
  await page.goto(url);
  await page.locator('.project-tree').getByRole('button', { name: 'Atlas', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a GitHub Projects board', exact: true }).click();
  await page.getByRole('button', { name: 'Atlas roadmap #1', exact: true }).click();
  await page.getByRole('button', { name: 'Connect board', exact: true }).click();
  await page.getByLabel('Search tasks').fill('authentication');
  await page.getByRole('button', { name: 'Review authentication', exact: true }).click();
  // The preview has no Git, so the agent works in the folder, not in a branch copy.
  await page.getByRole('radio', { name: 'In api-service on main', exact: true }).check();
  await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
  await expect(page.getByLabel('Message agent')).toHaveValue(/Review authentication/);
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByLabel('Search tasks')).toHaveValue('authentication');
  await expect(page.getByRole('region', { name: 'Tracker board', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Build the project overview', exact: true }),
  ).toHaveCount(0);
});
