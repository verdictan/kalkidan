import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder } from './helpers/navigation';

/** Opens a chat in a project. `board` connects a task board to the project. */
async function openChat(page: Page, setup: { board?: boolean }) {
  await page.addInitScript((choice) => {
    const session = { id: 's', agent: 'claude', title: 'Review', cwd: '/repo', updatedAt: '2' };
    const other = { id: 'o', agent: 'codex', title: 'Fix login', cwd: '/repo', updatedAt: '1' };
    const project = { id: 'P', title: 'Board', url: 'https://example.test/board', number: 1 };
    (window as any).requests = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
        ],
        groups: [
          {
            id: 'g',
            name: 'Project',
            repoIds: ['r'],
            ...(choice.board ? { tracker: { provider: 'github', project } } : {}),
          },
        ],
        sessions: [session, other],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      models: async () => [],
      transcript: async () => ({ messages: [], truncated: false }),
      mentionFiles: async () => ({
        files: ['README.md', 'src/auth.ts', 'src/app.tsx', 'docs/authoring.md'],
        truncated: false,
      }),
      docsMetadata: async () => [{ id: 'd1', title: 'Auth flow', parentId: null }],
      memoryEntries: async () => [
        {
          id: 'm1',
          topic: 'Test conventions',
          content: 'Run the unit tests before a commit.',
        },
      ],
      trackerBoard: async () => ({
        project,
        items: [{ id: 't1', title: 'Ship login', body: '', number: 7, status: 'Todo' }],
      }),
      chatStart: async (agent: string, id: string, prompt: string) => {
        (window as any).requests.push({ agent, id, prompt });
        return {
          id: 'run',
          sessionId: id,
          sessionReady: true,
          agent,
          status: 'completed',
          messages: [{ id: 'a', role: 'assistant', text: 'Done' }],
          activity: '',
        };
      },
      chatStatus: async () => ({
        id: 'run',
        sessionId: 's',
        sessionReady: true,
        agent: 'claude',
        status: 'completed',
        messages: [{ id: 'a', role: 'assistant', text: 'Done' }],
        activity: '',
      }),
    };
  }, setup);
  await page.goto('/');
  await openCodeFolder(page);
  await page.getByRole('button', { name: 'Resume Review', exact: true }).click();
  return page.getByLabel('Message agent');
}

const picker = (page: Page) => page.getByRole('listbox', { name: 'Mentions' });
const section = (page: Page, name: string) => picker(page).getByRole('group', { name });

test('"@" opens the picker with each section and its empty states', async ({ page }) => {
  const composer = await openChat(page, {});
  await composer.pressSequentially('@');
  await expect(picker(page)).toBeVisible();
  for (const name of ['Search', 'Files', 'Docs', 'Tasks', 'Memory', 'Chats'])
    await expect(section(page, name)).toBeVisible();
  await expect(section(page, 'Search').getByRole('option')).toHaveText(/@docs/);
  await expect(section(page, 'Tasks')).toContainText('Connect a board to mention tasks');
  await expect(section(page, 'Chats').getByRole('option')).toHaveText(/Fix login/);
  await expect(section(page, 'Memory').getByRole('option')).toHaveText(/Test conventions/);
  // Typing filters every section.
  await composer.pressSequentially('auth');
  await expect(section(page, 'Search')).toHaveCount(0);
  await expect(section(page, 'Files').getByRole('option').first()).toContainText('auth.ts');
  await expect(section(page, 'Docs').getByRole('option')).toHaveText('Auth flow');
  await expect(section(page, 'Chats')).toContainText('No chats match');
  await composer.pressSequentially('zzz');
  await expect(section(page, 'Files')).toContainText('No files match');
  // Escape closes the picker. A new "@" opens it again.
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  await composer.pressSequentially(' @');
  await expect(picker(page)).toBeVisible();
});

test('the keyboard and the mouse insert mentions, and the sent message shows chips', async ({
  page,
}) => {
  const composer = await openChat(page, { board: true });
  await composer.pressSequentially('Review @auth');
  const options = picker(page).getByRole('option');
  await expect(options.first()).toContainText('auth.ts');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);
  await expect(composer).toHaveValue('Review @[auth.ts](file:src/auth.ts) ');
  await expect(page.getByLabel('Mentions', { exact: true })).toContainText('auth.ts');
  // Tasks show when a board is connected. A click inserts the task.
  await composer.pressSequentially('and @ship');
  await expect(section(page, 'Tasks').getByRole('option')).toHaveText(/#7 Ship login/);
  await section(page, 'Tasks').getByRole('option').click();
  await expect(composer).toHaveValue(
    'Review @[auth.ts](file:src/auth.ts) and @[#7 Ship login](task:t1) ',
  );
  // Tab inserts too.
  await composer.pressSequentially('@Fix');
  await page.keyboard.press('Tab');
  await expect(composer).toHaveValue(/@\[Fix login\]\(chat:codex:o\) $/);
  // Backspace after a mention removes the whole mention.
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(composer).toHaveValue(
    'Review @[auth.ts](file:src/auth.ts) and @[#7 Ship login](task:t1) ',
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  const request = await page.evaluate(() => (window as any).requests.at(-1));
  expect(request.prompt).toBe('Review @[auth.ts](file:src/auth.ts) and @[#7 Ship login](task:t1) ');
  const sent = page.getByRole('list', { name: 'Mentioned items' });
  await expect(sent.getByRole('listitem')).toHaveText(['auth.ts', '#7 Ship login']);
  await expect(page.locator('.chat-message.user .chat-mention-inline')).toHaveText([
    '@auth.ts',
    '@#7 Ship login',
  ]);
});

test('"@docs" stays a search at the start of the message', async ({ page }) => {
  const composer = await openChat(page, {});
  await composer.pressSequentially('@do');
  await expect(section(page, 'Search').getByRole('option')).toHaveText(/@docs/);
  await page.keyboard.press('Enter');
  await expect(composer).toHaveValue('@docs ');
  await expect(picker(page)).toHaveCount(0);
});
