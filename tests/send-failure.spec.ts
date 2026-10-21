import { test, expect, type Page } from '@playwright/test';

/**
 * A refused send keeps the message in the transcript only. The composer is empty, and
 * "Try again" sends the same message again.
 */
async function installWorkspace(page: Page, options: { remote: boolean; slow?: boolean }) {
  await page.addInitScript(({ remote, slow }) => {
    const w = window as any;
    w.calls = [];
    w.release = () => undefined;
    const refused = (agent: string) => ({
      id: 'refused-' + w.calls.length,
      agent,
      sessionId: '',
      status: 'failed',
      messages: [],
      activity: '',
      errorCode: 'managed_launch_blocked',
      error:
        'Choose a subscription target for managed agents. desktop.subscription_target_required',
      managedSetup: 'agent-setup',
    });
    const answered = (agent: string) => ({
      id: 'answered',
      agent,
      sessionId: 'provider-session',
      sessionReady: true,
      status: 'completed',
      activity: '',
      messages: [{ id: 'answer', role: 'assistant', text: 'OK.' }],
    });
    /** The first send is refused. The next send gets an answer. */
    async function create(agent: string, prompt: string) {
      w.calls.push({ agent, prompt });
      if (slow && w.calls.length === 1) await new Promise((resolve) => (w.release = resolve));
      return w.calls.length === 1 ? refused(agent) : answered(agent);
    }
    const host = {
      id: 'h',
      name: 'Development',
      target: 'dev-server',
      status: 'connected',
      version: 'abc',
      node: 'v22.23.0',
      platform: 'linux',
    };
    w.workspace = {
      snapshot: async () => ({
        projects: [
          {
            id: 'p1',
            name: 'web',
            path: remote ? '/home/dev/web' : '/tmp/web',
            hostId: remote ? 'h' : undefined,
            favorite: false,
            notes: '',
            addedAt: '',
          },
        ],
        groups: [{ id: 'g1', name: 'Atlas', repoIds: ['p1'], hostId: remote ? 'h' : undefined }],
        hosts: remote ? [host] : [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      remoteHosts: async () => (remote ? [host] : []),
      git: async () => null,
      launch: async () => {
        throw new Error('Terminal must not open');
      },
      chatCreate: async (_projectId: string, agent: string, prompt: string) =>
        create(agent, prompt),
      chatStart: async (agent: string, _id: string, prompt: string) => create(agent, prompt),
      chatStatus: async () => answered('codex'),
      remoteCall: async (_hostId: string, method: string, args: any[]) => {
        if (method === 'models') return [];
        if (method === 'chatCreate' || method === 'chatStart') return create(args[1], args[2]);
        if (method === 'chatStatus') return answered('codex');
        return null;
      },
    };
  }, options);
}

async function newChat(page: Page, agent: 'codex' | 'claude') {
  await page.goto('/');
  await page.locator('.repo-select').first().click();
  if (agent === 'codex')
    await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Choose an agent', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New Claude Code chat', exact: true }).click();
  }
  await expect(page.getByRole('region', { name: 'Chats', exact: true })).toBeVisible();
}

for (const remote of [false, true])
  for (const agent of ['claude', 'codex'] as const)
    test(`a refused ${agent} send ${remote ? 'on an SSH host ' : ''}leaves the composer and can be sent again`, async ({
      page,
    }) => {
      await installWorkspace(page, { remote });
      await newChat(page, agent);
      const composer = page.getByLabel('Message agent');
      await composer.fill('Reply OK.');
      await composer.press('Enter');
      const message = page.locator('.chat-message.user');
      await expect(message).toHaveCount(1);
      await expect(message).toContainText('Reply OK.');
      await expect(message.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(
        message.getByRole('button', { name: 'Change agent', exact: true }),
      ).toBeVisible();
      // The agent did not start, so the chat has no session. The card says that it is not saved.
      const unsaved = message.getByText('This chat is not saved because the agent did not start.');
      await expect(unsaved).toBeVisible();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('kalkidan-open-chats') || '[]')),
      ).toEqual([]);
      // The message is in the transcript. It is not in the composer too.
      await expect(composer).toHaveValue('');
      await message.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByText('OK.', { exact: true })).toBeVisible();
      await expect(message).toHaveCount(1);
      await expect(message.getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(unsaved).toHaveCount(0);
      await expect(composer).toHaveValue('');
      expect(await page.evaluate(() => (window as any).calls.map((c: any) => c.prompt))).toEqual([
        'Reply OK.',
        'Reply OK.',
      ]);
    });

test('text typed while a message sends stays in the composer after a refusal', async ({ page }) => {
  await installWorkspace(page, { remote: false, slow: true });
  await newChat(page, 'claude');
  const composer = page.getByLabel('Message agent');
  await composer.fill('Reply OK.');
  await composer.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).calls.length)).toBe(1);
  await composer.fill('My next question');
  await page.evaluate(() => (window as any).release());
  await expect(page.locator('.chat-message.user')).toContainText('Reply OK.');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(composer).toHaveValue('My next question');
});

test('a send that fails before the transcript accepts it keeps the draft', async ({ page }) => {
  await installWorkspace(page, { remote: false });
  await newChat(page, 'codex');
  const composer = page.getByLabel('Message agent');
  // Whitespace only is not a message. Nothing is sent, and the text stays.
  await composer.fill('   ');
  await composer.press('Enter');
  await expect(page.locator('.chat-message.user')).toHaveCount(0);
  await expect(composer).toHaveValue('   ');
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(0);
});
