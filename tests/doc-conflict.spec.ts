import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const docs: Record<string, any> = {
      p: { id: 'p', title: 'Guide', parentId: null, markdown: 'Original', revision: '1' },
    };
    (window as any).testDocs = docs;
    (window as any).workspace = {
      trackerProviders: async () => [],
      snapshot: async () => ({
        projects: [],
        groups: [{ id: 'g', name: 'Project', repoIds: [] }],
        sessions: [],
        warnings: [],
        platform: 'darwin',
      }),
      docsMetadata: async () =>
        Object.values(docs).map(({ id, title, parentId }) => ({ id, title, parentId })),
      docsRead: async (_group: string, id: string) => {
        if (!docs[id]) throw Error('ENOENT: page deleted');
        return { ...docs[id] };
      },
      docsSave: async (_group: string, doc: any) => {
        if (!docs[doc.id]) throw Error('ENOENT: page deleted');
        if (docs[doc.id].revision !== doc.revision) throw Error('This page changed on disk.');
        docs[doc.id] = { ...doc, revision: String(Number(doc.revision) + 1) };
        return { ...docs[doc.id] };
      },
      docsCreate: async (_group: string, title: string, parentId: string | null) => {
        const id = 'copy';
        return (docs[id] = { id, title, parentId, markdown: '', revision: '1' });
      },
    };
  });
});

test('a conflicting Docs draft can be saved as a new page without replacing disk content', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Guide');
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Markdown source' }).click();
  await page.evaluate(() => {
    (window as any).testDocs.p = {
      ...(window as any).testDocs.p,
      markdown: 'Someone else changed this',
      revision: '2',
    };
  });
  await page.getByLabel('Markdown content').fill('My unsaved draft');
  await expect(page.getByRole('button', { name: 'Save as new page' })).toBeVisible();
  await page.getByLabel('Markdown content').fill('My latest unsaved draft');
  await page.getByRole('button', { name: 'Save as new page' }).click();
  await expect(page.getByLabel('Page title', { exact: true })).toHaveValue('Guide (recovered)');
  expect(await page.evaluate(() => (window as any).testDocs.p.markdown)).toBe(
    'Someone else changed this',
  );
  expect(await page.evaluate(() => (window as any).testDocs.copy.markdown)).toBe(
    'My latest unsaved draft',
  );
});

test('legacy draft recovery retains the old revision and does not overwrite the current page', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'kalkidan-doc-draft:g:p',
      JSON.stringify({
        id: 'p',
        title: 'Guide',
        parentId: null,
        markdown: 'Recovered text',
        revision: 'old',
      }),
    );
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save as new page' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).testDocs.p.markdown)).toBe('Original');
  expect(await page.evaluate(() => localStorage.getItem('kalkidan-doc-draft:g:p'))).toContain(
    'Recovered text',
  );
  await page.getByRole('button', { name: 'Save as new page' }).click();
  expect(await page.evaluate(() => (window as any).testDocs.copy.markdown)).toBe('Recovered text');
  expect(await page.evaluate(() => localStorage.getItem('kalkidan-doc-draft:g:p'))).toBeNull();
});
