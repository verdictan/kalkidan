import { test, expect } from '@playwright/test';
test('reopening an uncertain project creation resumes its original request', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kalkidan:onboarding:v1', 'dismissed');
    const groups: any[] = [];
    const calls: any[] = [];
    (window as any).creates = calls;
    (window as any).workspace = {
      snapshot: async () => ({
        projects: [],
        sessions: [],
        warnings: [],
        platform: 'darwin',
        groups: structuredClone(groups),
      }),
      createGroup: async (...args: any[]) => {
        calls.push(args);
        if (!groups.length) groups.push({ id: args[5], name: args[0], repoIds: [] });
        if (calls.length === 1) throw new Error('Response lost. Resume setup.');
        return args[5];
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Project name', exact: true })
    .fill('Recovered project');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Response lost');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(
    'Recovered project',
  );
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Resume setup', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const calls = await page.evaluate(() => (window as any).creates);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
});
