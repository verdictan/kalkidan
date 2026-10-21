import { test, expect, type Page } from '@playwright/test';
import { openCodeFolder } from './helpers/navigation';

/** Opens a Claude Code chat. `allowed` is the model list of the organization, if any. */
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
  await page.getByRole('button', { name: 'Resume Review', exact: true }).click();
}

async function send(page: Page, text: string) {
  await page.getByLabel('Message agent').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  return page.evaluate(() => (window as any).requests.at(-1));
}

test('one allowed model shows as a label with the reason', async ({ page }) => {
  await openChat(page, { model: 'sonnet', allowed: ['sonnet'] });
  await expect(page.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveCount(0);
  const label = page.getByRole('note', { name: /^Model: Sonnet\./ });
  await expect(label).toHaveText('Sonnet');
  await label.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Your organization sets the model.');
  // The chat picks no model, so the setup model applies.
  expect((await send(page, 'Hello')).model).toBeUndefined();
});

test('the model chip lists only the allowed models and marks the setup default', async ({
  page,
}) => {
  await openChat(page, { model: 'sonnet', allowed: ['sonnet', 'opus'] });
  const chip = page.getByRole('combobox', { name: 'Model', exact: true });
  await expect(chip).toHaveText('Sonnet');
  await chip.click();
  const options = page.getByRole('option');
  await expect(options).toHaveText(['SonnetDefault', 'Opus']);
  await page.getByRole('option', { name: 'Opus', exact: true }).click();
  await expect(chip).toHaveText('Opus');
  expect((await send(page, 'Use Opus')).model).toBe('opus');
});

test('without managed setup, the chip keeps the agent models', async ({ page }) => {
  await openChat(page, {});
  const chip = page.getByRole('combobox', { name: 'Model', exact: true });
  await expect(chip).toHaveText('Claude Code · Default');
  await chip.click();
  await expect(page.getByRole('option')).toHaveText([
    'Claude Code · Default',
    'Sonnet',
    'Opus',
    'Haiku',
  ]);
  await page.getByRole('option', { name: 'Haiku', exact: true }).click();
  expect((await send(page, 'Use Haiku')).model).toBe('haiku');
});
