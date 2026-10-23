import { type Page } from '@playwright/test';
import { test, expect } from './helpers/app';
import { openCodeFolder, openTreeChat } from './helpers/navigation';

/**
 * Opens a Claude Code chat. The desktop app finds Claude Code on this computer, but not Codex.
 * `allowed` is the model list of the organization, if any.
 */
async function openChat(page: Page, setup: { model?: string; allowed?: string[] }) {
  await page.addInitScript((choice) => {
    const session = { id: 's', agent: 'claude', title: 'Review', cwd: '/repo', updatedAt: '' };
    (window as any).requests = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [
          { id: 'r', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
        ],
        groups: [{ id: 'g', name: 'Project', repoIds: ['r'] }],
        sessions: [session],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      toolStatus: async () => ({
        computer: 'local',
        name: 'This Mac',
        connected: true,
        checkedAt: '',
        tools: [
          {
            tool: 'claude',
            name: 'Claude Code',
            kind: 'agent',
            state: 'ready',
            installed: true,
            version: '2.0.14',
            signedIn: 'yes',
            access: 'granted',
            usable: true,
            installUrl: 'https://example.test/claude',
          },
          {
            tool: 'codex',
            name: 'Codex',
            kind: 'agent',
            state: 'missing',
            installed: false,
            signedIn: 'unknown',
            access: 'unknown',
            usable: false,
            installUrl: 'https://example.test/codex',
          },
        ],
      }),
      models: async () => [
        { id: 'sonnet', name: 'Sonnet' },
        { id: 'opus', name: 'Opus' },
        { id: 'haiku', name: 'Haiku' },
      ],
      transcript: async () => ({ messages: [], truncated: false }),
      verdictanSetup: async () => ({
        status: 'ready',
        teams: [],
        policies: [],
        providerConnections: [],
        ...(choice.allowed ? { allowedModels: { claude: choice.allowed } } : {}),
        selections: choice.model
          ? {
              claude: {
                teamId: 't',
                configurationId: '',
                configurationVersionId: '',
                providerConnectionId: 'pc',
                model: choice.model,
              },
            }
          : {},
      }),
      chatStart: async (
        agent: string,
        id: string,
        prompt: string,
        _edits: boolean,
        options: any,
      ) => {
        (window as any).requests.push({ agent, id, prompt, model: options?.model });
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
  await openTreeChat(page, 'Review');
}

async function send(page: Page, text: string) {
  await page.getByLabel('Message agent').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  return page.evaluate(() => (window as any).requests.at(-1));
}

const chip = (page: Page) => page.getByRole('button', { name: 'Agent: Claude Code', exact: true });

test('the agent chip lists the detected agents and the chat picks no model', async ({ page }) => {
  // The organization setup has a model. The composer has no model choice: the agent CLI and the
  // organization policy choose the model.
  await openChat(page, { model: 'sonnet', allowed: ['sonnet', 'opus'] });
  await expect(page.getByRole('button', { name: /^Agent and model:/ })).toHaveCount(0);
  await chip(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('On this computer');
  const claude = menu.getByRole('menuitem', { name: /Claude Code/ });
  await expect(claude).toContainText('2.0.14');
  await expect(claude.getByLabel('Selected', { exact: true })).toBeVisible();
  // An agent that Kalkidan did not find opens its official page.
  await expect(menu.getByRole('menuitem', { name: /Codex/ })).toContainText('Not installed');
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Manage agents…' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await send(page, 'Hello')).model).toBeUndefined();
});

test('the agent chip lists the agents and the restart line, not Tools…', async ({ page }) => {
  await openChat(page, {});
  await chip(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('Installed another agent? Restart Kalkidan to find it.');
  await expect(menu.getByRole('menuitem', { name: 'Tools…', exact: true })).toHaveCount(0);
});
