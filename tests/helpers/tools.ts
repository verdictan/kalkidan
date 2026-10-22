import type { Page } from '@playwright/test';

type Tool = 'Browser' | 'Terminal' | 'Changes';

// Open a tool from the "Tools" group in the title bar. A selected tool button hides the tools,
// so the helper clicks only a tool that is not open. Changes shows only when there are changes.
export async function openTool(page: Page, tool: Tool) {
  const button = page.getByRole('group', { name: 'Tools', exact: true }).getByRole('button', {
    name: tool === 'Changes' ? /^Changes/ : tool,
    exact: tool !== 'Changes',
  });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
}
