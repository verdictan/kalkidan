import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });

/** A project with one saved chat of another organization, on this computer or an SSH host. */
async function withForeignChat(page: Page, remote = false) {
  await page.addInitScript((remote) => {
    const hostId = remote ? 'h' : undefined;
    const host = {
      id: 'h',
      name: 'Development',
      target: 'dev-server',
      status: 'connected',
      version: 'abc',
      node: 'v22.23.0',
      platform: 'linux',
    };
    const messages = [
      { id: 'u1', role: 'user', text: 'Check the login flow.' },
      { id: 'a1', role: 'assistant', text: 'The login flow skips the rate limit.' },
    ];
    (window as any).ownershipCalls = [];
    (window as any).workspace = {
      trackerProviders: async () => [],
      git: async () => null,
      models: async () => [],
      transcript: async () => ({ messages, truncated: false }),
      remoteHosts: async () => (remote ? [host] : []),
      remoteCall: async (_hostId: string, method: string) =>
        method === 'transcript' ? { messages, truncated: false } : method === 'models' ? [] : null,
      // The main process reads the binding on the host. The renderer sends the host ID.
      conversationOwnership: async (agent: string, id: string, host?: string) => {
        (window as any).ownershipCalls.push([agent, id, host ?? null]);
        return id === 'foreign' && host === hostId
          ? { state: 'other', scope: 'organization' }
          : { state: 'unmanaged' };
      },
      snapshot: async () => ({
        projects: [
          {
            id: 'r',
            name: 'web',
            path: remote ? '/home/dev/web' : '/tmp/web',
            hostId,
            favorite: false,
            notes: '',
            addedAt: '',
          },
        ],
        groups: [{ id: 'g', name: 'Accounts', repoIds: ['r'], hostId }],
        hosts: remote ? [host] : [],
        sessions: [
          {
            id: 'foreign',
            agent: 'codex',
            cwd: remote ? '/home/dev/web' : '/tmp/web',
            hostId,
            title: 'Login review',
            updatedAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
          },
        ],
        warnings: [],
        platform: 'darwin',
      }),
    };
  }, remote);
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

test('a conversation on an SSH host of another organization is read-only too', async ({ page }) => {
  await withForeignChat(page, true);
  const notice = page.getByRole('status', { name: 'Read-only conversation' });
  await expect(notice).toContainText(
    'This conversation belongs to another organization. It is read-only.',
  );
  await expect(page.getByLabel('Message agent')).not.toBeEditable();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).ownershipCalls)).toContainEqual([
    'codex',
    'foreign',
    'h',
  ]);
  await notice.getByRole('button', { name: 'Start a new conversation' }).click();
  const message = page.getByRole('textbox', { name: 'Message agent' });
  await expect(message).toBeEditable();
  await expect(message).toHaveValue('');
});
