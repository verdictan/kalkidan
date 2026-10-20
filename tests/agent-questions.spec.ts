import { test, expect } from '@playwright/test';

test('agent questions accept keyboard answers without granting permissions', async ({ page }) => {
  await page.addInitScript(() => {
    let run: any;
    (window as any).sentAnswers = [];
    const session = { id: 's', agent: 'codex', title: 'Plan work', cwd: '/repo', updatedAt: '' };
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
      transcript: async () => ({ messages: [], truncated: false }),
      chatStart: async () =>
        (run = {
          id: 'run',
          agent: 'codex',
          sessionId: 's',
          status: 'running',
          sessionReady: true,
          messages: [],
          activity: 'Waiting for your answer',
          approvals: [],
          requests: [
            {
              id: 'q',
              runId: 'run',
              provider: 'codex',
              kind: 'question',
              status: 'pending',
              questions: [
                {
                  id: 'name',
                  label: 'Name',
                  question: 'What name?',
                  kind: 'text',
                  options: [],
                  allowOther: true,
                  secret: false,
                },
                {
                  id: 'db',
                  label: 'Database',
                  question: 'Which database?',
                  kind: 'single-choice',
                  options: [
                    { label: 'SQLite', description: 'Local database' },
                    { label: 'Postgres', description: 'Shared database' },
                  ],
                  allowOther: false,
                  secret: false,
                },
              ],
            },
          ],
        }),
      chatStatus: async () => run,
      chatRespond: async (id: string, request: string, answers: any) => {
        (window as any).sentAnswers.push({ id, request, answers });
        run = {
          ...run,
          status: 'completed',
          activity: 'Response complete',
          requests: [{ ...run.requests[0], status: 'answered' }],
        };
      },
      chatApprove: async () => {
        throw Error('Questions must not grant permissions');
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.repo-select').click();
  await page.getByRole('button', { name: 'Resume Plan work', exact: true }).click();
  await page.getByLabel('Message agent').fill('Plan the implementation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const form = page.getByRole('form', { name: 'Agent questions' });
  await expect(form.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  await form.getByLabel('Name', { exact: true }).fill('Atlas');
  await form.getByRole('radio', { name: /SQLite/ }).focus();
  await page.keyboard.press('Space');
  await form.getByRole('button', { name: 'Send answer' }).focus();
  await page.keyboard.press('Enter');
  await expect(form).toContainText('Answer sent.');
  expect(await page.evaluate(() => (window as any).sentAnswers)).toEqual([
    { id: 'run', request: 'q', answers: { name: ['Atlas'], db: ['SQLite'] } },
  ]);
});
