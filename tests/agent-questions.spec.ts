import { test, expect } from './helpers/app';
import { openCodeFolder, openTreeChat } from './helpers/navigation';

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
  await page.goto('/');
  await openCodeFolder(page);
  await openTreeChat(page, 'Plan work');
  await page.getByLabel('Message agent').fill('Plan the implementation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  // The question shows in the frame of the composer, in place of the text box.
  const form = page.getByRole('form', { name: 'Agent question' });
  await expect(form.getByRole('button', { name: 'Answer', exact: true })).toBeDisabled();
  await form.getByLabel('Name', { exact: true }).fill('Atlas');
  await form.getByRole('radio', { name: /Postgres/ }).focus();
  await page.keyboard.press('Space');
  await form.getByRole('button', { name: 'Answer', exact: true }).focus();
  await page.keyboard.press('Enter');
  // The composer shows only open questions.
  await expect(form).toHaveCount(0);
  await expect(page.getByLabel('Message agent')).toBeVisible();
  expect(await page.evaluate(() => (window as any).sentAnswers)).toEqual([
    { id: 'run', request: 'q', answers: { name: ['Atlas'], db: ['Postgres'] } },
  ]);
});
