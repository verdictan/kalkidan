import type { Page } from '@playwright/test';

type Tool = 'Browser' | 'Terminal' | 'Changes';

// Open a tool through the title bar launcher: "New tool tab", then the tool row.
export async function openTool(page: Page, tool: Tool) {
  await page.getByRole('button', { name: 'New tool tab', exact: true }).click();
  await page
    .getByRole('region', { name: 'Repository tools', exact: true })
    .getByRole('button', { name: tool, exact: true })
    .click();
}
