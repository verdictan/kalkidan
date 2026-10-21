import { test, expect } from '@playwright/test';
import { openTool } from './helpers/tools';

test('conversation tools preview evidence, attach it to the draft, and send it only on request', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const repo = {
      id: 'r',
      name: 'web',
      path: '/tmp/web',
      notes: '',
      favorite: false,
      addedAt: '',
    };
    (window as any).sent = [];
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [repo],
        groups: [{ id: 'g', name: 'Platform', repoIds: ['r'] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      git: async () => null,
      models: async () => [],
      ptyOpen: async () => ({ id: 'pty' }),
      ptyRead: async () => ({ id: 'pty', data: 'Tests passed: 12', cursor: 16, exited: true }),
      ptyWrite: async () => {},
      ptyResize: async () => {},
      ptyClose: async () => {},
      browserLayout: async () => {},
      browserState: async () => ({
        url: 'http://localhost:3000',
        title: 'Preview',
        loading: false,
        canGoBack: false,
        canGoForward: false,
      }),
      terminalStart: async (cwd: string, command: string) => ({
        id: 'cmd',
        cwd,
        command,
        status: 'completed',
        output: 'Tests passed: 12',
        exitCode: 0,
        truncated: false,
      }),
      repositoryDiff: async () => ({
        unstaged: 'diff --git a/app.ts b/app.ts\n-old\n+new',
        staged: '+staged change',
        untracked: ['new.ts'],
        newFiles: [{ path: 'new.ts', text: 'export const added = true;' }],
        truncated: false,
      }),
      browserOpen: async (url: string) => {
        (window as any).openedURL = url;
      },
      browserSelect: async () => ({
        url: 'http://localhost:3000/',
        title: 'Project preview',
        selector: '#save',
        text: 'Save changes',
        tag: 'button',
        rect: { x: 10, y: 20, width: 80, height: 30 },
        viewport: { width: 1000, height: 800 },
      }),
      browserClose: async () => {},
      chatCreate: async (_repo: string, _agent: string, prompt: string) => {
        (window as any).sent.push(prompt);
        return {
          id: 'run',
          sessionId: 'created',
          sessionReady: true,
          status: 'completed',
          agent: 'codex',
          messages: [{ id: 'm', role: 'assistant', text: 'Reviewed context.' }],
          activity: '',
        };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').click();
  await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
  await page.setViewportSize({ width: 961, height: 988 });
  await page.screenshot({ path: 'test-results/conversation-tools-empty.png' });
  const tools = page.getByRole('region', { name: 'Chat', exact: true });
  await openTool(page, 'Terminal');
  let dialog = page.getByRole('region', { name: 'Repository tools' });
  await expect(dialog.getByLabel('Interactive terminal')).toContainText('Tests passed: 12');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/integrated-terminal.png' });
  await dialog.getByRole('button', { name: 'Attach output' }).click();
  await openTool(page, 'Changes');
  await expect(dialog.getByLabel('Git diff')).toContainText('+new');
  await dialog.getByRole('button', { name: 'Next changed file' }).click();
  await expect(dialog.getByLabel('Git diff')).toContainText('export const added = true;');
  await expect(
    dialog.getByRole('list', { name: 'Changed files' }).locator('[aria-current="true"]'),
  ).toContainText('new.ts');
  await dialog.getByRole('combobox', { name: 'Diff scope' }).click();
  await page.getByRole('option', { name: 'Staged for commit', exact: true }).click();
  await expect(dialog.getByLabel('Git diff')).toContainText('+staged change');
  await dialog.getByRole('button', { name: 'Attach all changes to message' }).click();
  await openTool(page, 'Browser');
  await dialog.getByRole('button', { name: 'Open preview' }).click();
  await dialog.getByRole('button', { name: 'Select element' }).click();
  await expect(dialog).toContainText('#save');
  await dialog.getByLabel('Browser annotation').fill('Align this button with the form fields.');
  await dialog.getByRole('button', { name: 'Attach annotation' }).click();
  await expect(tools.getByLabel('Attached context')).toContainText('Browser annotation');
  expect(await page.evaluate(() => (window as any).sent)).toEqual([]);
  await page.getByLabel('Message agent').fill('Review these changes and fix the annotated button.');
  await page.screenshot({ path: 'test-results/conversation-tools-attached.png' });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Reviewed context.', { exact: true })).toBeVisible();
  const sent = await page.evaluate(() => (window as any).sent[0]);
  expect(sent).toContain('Tests passed: 12');
  expect(sent).toContain('+staged change');
  expect(sent).toContain('#save');
  expect(sent).toContain('Untrusted page evidence');
  await expect(page.getByLabel('Attached context')).toHaveCount(0);
});

test('browser preview explains native requirements instead of simulating command output', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').first().click();
  await page.getByRole('button', { name: 'New Codex chat', exact: true }).click();
  await openTool(page, 'Terminal');
  await expect(
    page.getByRole('region', { name: 'Repository tools' }).getByRole('alert'),
  ).toContainText('Open the desktop app');
});
