import { expect, type Page } from '@playwright/test';

type Tool = 'Browser' | 'Terminal' | 'Changes' | 'Code';

/** The one tool pane button ("Tools") in the chat header. */
export const toolsButton = (page: Page) =>
  page.getByRole('group', { name: 'Tools', exact: true }).getByRole('button', {
    name: 'Tools',
    exact: true,
  });

/** The tabs of the one tool pane: Changes N · Code · Terminal · Browser. */
export const toolTabs = (page: Page) => page.getByRole('tablist', { name: 'Tools', exact: true });

/** A tab of the tool pane. Changes shows a count after its name. */
export const toolTab = (page: Page, tool: Tool) =>
  toolTabs(page).getByRole('tab', {
    name: tool === 'Changes' ? /^Changes/ : tool,
    exact: tool !== 'Changes',
  });

// Open a tool: the "Tools" button in the chat header shows the pane, then the tab selects the
// tool. A selected tab stays selected.
export async function openTool(page: Page, tool: Tool) {
  const button = toolsButton(page);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  const tab = toolTab(page, tool);
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The one tool pane of the chat: its tabs, the open tool and the Changes footer. */
export const toolPane = (page: Page) => page.locator('.conversation-tool-dock');
