import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });

/** A project with one saved chat of another organization. */
async function withForeignChat(page: Page) {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      git: async () => null,
      models: async () => [],
      transcript: async () => ({
        messages: [
          { id: 'u1', role: 'user', text: 'Check the login flow.' },
          { id: 'a1', role: 'assistant', text: 'The login flow skips the rate limit.' },
        ],
        truncated: false,
      }),
      conversationOwnership: async (_agent: string, id: string) =>
        id === 'foreign' ? { state: 'other', scope: 'organization' } : { state: 'unmanaged' },
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' },
        ],
        groups: [{ id: 'g', name: 'Accounts', repoIds: ['r'] }],
        sessions: [
          {
            id: 'foreign',
            agent: 'codex',
            cwd: '/tmp/web',
            title: 'Login review',
            updatedAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
          },
        ],
        warnings: [],
        platform: 'darwin',
      }),
    };
  });
  await page.goto('/');
  await tree(page).getByRole('button', { name: 'Chat: Login review' }).click();
}

test('a conversation of another organization is read-only and offers a new conversation', async ({
  page,
}) => {
  await withForeignChat(page);
  const notice = page.getByRole('status', { name: 'Read-only conversation' });
  await expect(notice).toContainText(
    'This conversation belongs to another organization. It is read-only.',
  );
  await expect(notice).toContainText('Its context and usage stay with that account.');
  // The earlier messages stay visible. The composer accepts no new message.
  await expect(page.getByRole('log', { name: 'Chat messages' })).toContainText(
    'The login flow skips the rate limit.',
  );
  const composer = page.getByLabel('Message agent');
  await expect(composer).toHaveAttribute('readonly', '');
  await expect(composer).not.toBeEditable();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.screenshot({
    path: 'test-results/conversation-read-only.png',
    animations: 'disabled',
  });

  // A new conversation opens empty under the active account. No context moves.
  await notice.getByRole('button', { name: 'Start a new conversation' }).click();
  const message = page.getByRole('textbox', { name: 'Message agent' });
  await expect(message).toBeEditable();
  await expect(message).toHaveValue('');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'New Codex chat',
  );
  await expect(page.getByRole('status', { name: 'Read-only conversation' })).toBeHidden();
});
