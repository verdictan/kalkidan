import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';

const tree = (page: Page) => page.getByRole('navigation', { name: 'Projects and repositories' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Fork chat', exact: true });

/**
 * A Mac chat in the Atlas project. The SSH host Development has a code folder of the same
 * project. The SSH host Empty has no code folder.
 */
async function withChat(
  page: Page,
  options: { messages?: number; readOnly?: 'other' | 'agent_unavailable' } = {},
) {
  await page.addInitScript(({ messages: count = 2, readOnly }) => {
    const w = window as any;
    const host = (id: string, name: string) => ({
      id,
      name,
      target: id + '-server',
      status: 'connected',
      version: 'abc',
      node: 'v22.23.0',
      platform: 'linux',
    });
    const hosts = [host('h', 'Development'), host('e', 'Empty')];
    const messages = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      role: i % 2 ? 'assistant' : 'user',
      text: `${i} ` + (count > 2 ? 'x'.repeat(2000) : 'Check the login flow.'),
    }));
    const source = {
      id: 'source',
      agent: 'codex',
      cwd: '/tmp/web',
      title: 'Login review',
      updatedAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
      organization: {} as Record<string, unknown>,
    };
    const sessions: any[] = [source];
    w.calls = { create: [] as unknown[], update: [] as unknown[] };
    const answered = (agent: string) => ({
      id: 'run-1',
      agent,
      sessionId: 'h::fork-1',
      sessionReady: true,
      status: 'completed',
      activity: '',
      messages: [{ id: 'answer', role: 'assistant', text: 'I continue from the history.' }],
    });
    w.workspace = {
      trackerProviders: async () => [],
      git: async () => null,
      models: async () => [],
      transcript: async () => ({ messages, truncated: false }),
      remoteHosts: async () => hosts,
      conversationOwnership: async (_agent: string, id: string) =>
        readOnly === 'other' && id === 'source'
          ? { state: 'other', scope: 'organization' }
          : readOnly && id === 'source'
            ? { state: readOnly }
            : { state: 'unmanaged' },
      verdictanSetup: async () => ({
        status: 'ready',
        teams: [],
        policies: [],
        providerConnections: [],
        agents: [
          {
            agent_id: 'a1',
            team_id: 't',
            name: 'Release bot',
            configuration_id: 'c',
            configuration_version_id: 'v',
          },
          {
            agent_id: 'a2',
            team_id: 't',
            name: 'Review bot',
            configuration_id: 'c',
            configuration_version_id: 'v',
          },
        ],
        selections: {},
        // Each computer has one agent for both coding agents.
        computerAgents: { local: 'a1', h: 'a2' },
      }),
      remoteCall: async (_hostId: string, method: string, args: any[]) => {
        if (method === 'models') return [];
        if (method === 'chatCreate') {
          w.calls.create.push(args);
          sessions.push({
            id: 'h::fork-1',
            agent: args[1],
            cwd: '/home/dev/web',
            hostId: 'h',
            title: 'Continue',
            updatedAt: new Date().toISOString(),
          });
          return answered(args[1]);
        }
        if (method === 'chatStatus') return answered('claude');
        return null;
      },
      updateSession: async (agent: string, id: string, changes: Record<string, unknown>) => {
        w.calls.update.push([agent, id, changes]);
        const session = sessions.find((s) => s.agent === agent && s.id === id);
        if (session) session.organization = { ...session.organization, ...changes };
      },
      snapshot: async () => ({
        projects: [
          { id: 'mac', name: 'web', path: '/tmp/web', favorite: false, notes: '', addedAt: '' },
          {
            id: 'dev',
            name: 'web',
            path: '/home/dev/web',
            hostId: 'h',
            favorite: false,
            notes: '',
            addedAt: '',
          },
        ],
        groups: [{ id: 'g', name: 'Atlas', repoIds: ['mac', 'dev'] }],
        hosts,
        sessions: structuredClone(sessions),
        warnings: [],
        platform: 'darwin',
      }),
    };
  }, options);
  await page.goto('/');
}

async function chooseComputer(page: Page, name: string) {
  await dialog(page).getByRole('combobox', { name: 'Computer', exact: true }).click();
  await page.getByRole('option', { name, exact: false }).first().click();
}

test('a chat forks to another coding agent on an SSH host with its full history', async ({
  page,
}) => {
  await withChat(page);
  const row = tree(page).getByRole('button', { name: 'Chat: Login review', exact: true });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Fork chat…', exact: true }).click();

  // The defaults are the coding agent and the computer of the chat.
  const fork = dialog(page);
  await expect(fork.getByRole('combobox', { name: 'Coding agent' })).toHaveText(
    'Codex (this chat)',
  );
  await expect(fork.getByRole('combobox', { name: 'Computer' })).toHaveText('This Mac (this chat)');
  await expect(fork.getByTestId('fork-agent')).toHaveText(
    'Verdictan agent: Release bot. The fork uses the current agent of this Mac.',
  );
  await expect(fork.getByRole('status')).toHaveText(
    'The fork gets all 2 messages of this chat as context.',
  );

  // A computer without the project: a clear message, and no fork.
  await chooseComputer(page, 'Empty');
  await expect(fork.getByRole('alert')).toHaveText(
    'The project "Atlas" is not on Empty. Add its code folder on Empty, then fork again.',
  );
  await expect(fork.getByRole('button', { name: 'Fork chat', exact: true })).toBeDisabled();

  // The SSH host with the project, and the other coding agent.
  await chooseComputer(page, 'Development');
  await fork.getByRole('combobox', { name: 'Coding agent' }).click();
  await page.getByRole('option', { name: 'Claude Code', exact: true }).click();
  await expect(fork.getByTestId('fork-agent')).toHaveText(
    'Verdictan agent: Review bot. The fork uses the current agent of Development. Claude Code gets the history of the Codex chat as context.',
  );
  await expect(fork.getByRole('alert')).toHaveCount(0);
  await fork.getByRole('button', { name: 'Fork chat', exact: true }).click();
  await expect(fork).toHaveCount(0);

  // The fork is a new chat with a link back to the source.
  await expect(page.locator('.conversation-toolbar-title')).toHaveText('Login review (fork)');
  await expect(
    page.getByRole('button', { name: 'Forked from Login review', exact: true }),
  ).toBeVisible();
  const composer = page.getByLabel('Message agent');
  await composer.fill('Continue');
  await composer.press('Enter');
  await expect(page.getByText('I continue from the history.')).toBeVisible();

  // The first message starts a new chat on the host. The main process adds the history.
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls.create).toHaveLength(1);
  const [cwd, agent, prompt, , chatOptions] = calls.create[0];
  expect([cwd, agent, prompt]).toEqual(['/home/dev/web', 'claude', 'Continue']);
  expect(chatOptions.forkOf).toEqual({ agent: 'codex', id: 'source', title: 'Login review' });
  expect(chatOptions.forkFrom).toBeUndefined();
  // The history stops at the last message when the user forked.
  expect(chatOptions.forkUntil).toBe('1');
  // The fork keeps its title and source link. The source chat gets a "Forked to" link.
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.update))
    .toEqual(
      expect.arrayContaining([
        [
          'claude',
          'h::fork-1',
          expect.objectContaining({
            title: 'Login review (fork)',
            forkedFrom: { agent: 'codex', id: 'source', title: 'Login review' },
          }),
        ],
        [
          'codex',
          'source',
          { forks: [{ agent: 'claude', id: 'h::fork-1', title: 'Login review (fork)' }] },
        ],
      ]),
    );
  await page.getByRole('button', { name: 'Forked from Login review', exact: true }).click();
  await expect(page.locator('.conversation-toolbar-title')).toHaveText('Login review');
  await expect(
    page.getByRole('button', { name: 'Forked to Login review (fork)', exact: true }),
  ).toBeVisible();
});

test('a read-only chat with a long history forks from the header and the notice', async ({
  page,
}) => {
  await withChat(page, { messages: 60, readOnly: 'other' });
  await tree(page).getByRole('button', { name: 'Chat: Login review', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Read-only conversation' })).toBeVisible();
  await page.getByRole('button', { name: 'Chat actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fork chat…', exact: true }).click();
  const fork = dialog(page);
  await expect(fork).toBeVisible();
  await fork.getByRole('button', { name: 'Cancel', exact: true }).click();
  // The read-only notice also offers Fork.
  await page
    .getByRole('status', { name: 'Read-only conversation' })
    .getByRole('button', { name: 'Fork chat', exact: true })
    .click();
  await expect(fork.getByRole('status')).toHaveText(
    /^The history is too long for the agent\. The fork gets the most recent \d+ of 60 messages as context, with a note that earlier messages are missing\.$/,
  );
  await expect(fork.getByRole('button', { name: 'Fork chat', exact: true })).toBeEnabled();
  await fork.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(fork).toHaveCount(0);
});

test('a chat whose agent is gone offers Fork as the main action', async ({ page }) => {
  await withChat(page, { readOnly: 'agent_unavailable' });
  await tree(page).getByRole('button', { name: 'Chat: Login review', exact: true }).click();
  const notice = page.getByRole('status', { name: 'Read-only conversation' });
  await expect(notice).toContainText("This chat's agent is no longer available.");
  const fork = notice.getByRole('button', { name: 'Fork chat', exact: true });
  await expect(fork).toHaveAttribute('data-variant', 'default');
  await fork.click();
  await expect(dialog(page).getByTestId('fork-agent')).toHaveText(
    'Verdictan agent: Release bot. The fork uses the current agent of this Mac.',
  );
});
