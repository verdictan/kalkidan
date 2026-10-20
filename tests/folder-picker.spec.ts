import { test, expect } from '@playwright/test';
test('project folder browser navigates, filters, handles errors and selects a validated folder', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Test', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      directoryList: async (path: string) => {
        if (path === '/missing') throw Error('Folder does not exist');
        const target = path === '~' ? '/home/test' : path;
        return {
          path: target,
          parent: '/home/test',
          entries:
            target === '/home/test'
              ? [
                  { name: 'work', path: '/home/test/work', kind: 'directory' },
                  { name: '.config', path: '/home/test/.config', kind: 'directory' },
                  { name: 'readme.md', path: '/home/test/readme.md', kind: 'file' },
                ]
              : [],
        };
      },
    };
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('main').getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Browse folders' }).click();
  await expect(page.getByRole('button', { name: 'readme.md', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '.config', exact: true })).toHaveCount(0);
  await page.getByLabel('Show hidden').check();
  await expect(page.getByRole('button', { name: '.config', exact: true })).toBeVisible();
  await page.getByLabel('Filter folder entries').fill('work');
  await expect(page.getByRole('button', { name: 'readme.md', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'work', exact: true }).click();
  await expect(page.getByText('This folder is empty', { exact: true })).toBeVisible();
  await page.getByLabel('Browse folder path').fill('/missing');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Folder does not exist');
  await expect(page.getByRole('button', { name: 'Use this folder' })).toBeDisabled();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'work', exact: true }).click();
  await page.getByRole('button', { name: 'Use this folder' }).click();
  await expect(page.getByLabel('Project folder', { exact: true })).toHaveValue('/home/test/work');
});
