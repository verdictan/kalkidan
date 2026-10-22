/** The tabs of the Settings page, in order. */
export type SettingsTab = 'general' | 'accounts' | 'agents' | 'computers';

export const settingsTabs: { value: SettingsTab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'agents', label: 'Agents' },
  { value: 'computers', label: 'Computers' },
];

export function isSettingsTab(value: unknown): value is SettingsTab {
  return settingsTabs.some((tab) => tab.value === value);
}

/** The label of a tab, for example "Computers". */
export function settingsTabLabel(tab: SettingsTab) {
  return settingsTabs.find((item) => item.value === tab)?.label || 'General';
}

/** The element ID of one computer in Settings › Computers. No host ID means this computer. */
export function computerAnchor(hostId?: string) {
  return `computer-${hostId || 'local'}`;
}

/** The element ID of the managed runtime of one computer in Settings › Computers. */
export function runtimeAnchor(hostId?: string) {
  return `runtime-${hostId || 'local'}`;
}

/** The element ID of the "Update Kalkidan helper" button of one SSH host in Settings › Computers. */
export function helperUpdateAnchor(hostId: string) {
  return `helper-update-${hostId}`;
}

/** The element IDs in Settings that other parts of the app link to. */
export const settingsAnchors = {
  about: 'settings-about',
  defaultAgent: 'settings-default-agent',
  account: 'verdictan-account',
  region: 'verdictan-region',
  managedSetup: 'managed-agent-setup',
} as const;

/** The anchors of the older Managed agents section and the tab that now holds each one. */
const anchorTabs: Record<string, SettingsTab> = {
  [settingsAnchors.account]: 'accounts',
  [settingsAnchors.region]: 'accounts',
  [settingsAnchors.managedSetup]: 'agents',
  [settingsAnchors.defaultAgent]: 'agents',
  [settingsAnchors.about]: 'general',
};

/**
 * The tab and the element that get focus for a request to open Settings. The request can use
 * the names of the older sections: 'about', 'managed-agents', 'remote', and 'updates'. A known
 * anchor selects its own tab, so an older section name with a moved anchor still opens the
 * anchor.
 */
export function settingsTarget(
  section?: string,
  anchor?: string,
): { tab: SettingsTab; anchor?: string } {
  // The runtime moved from Managed agents to the row of this computer in Computers.
  const id = anchor === 'verdictan-runtime' ? runtimeAnchor() : anchor || undefined;
  if (id) {
    if (anchorTabs[id]) return { tab: anchorTabs[id], anchor: id };
    if (id.startsWith('computer-') || id.startsWith('runtime-') || id.startsWith('helper-update-'))
      return { tab: 'computers', anchor: id };
    if (id === 'settings-agents' || id.startsWith('agent-')) return { tab: 'agents', anchor: id };
  }
  switch (section) {
    case 'about':
      return { tab: 'general', anchor: id || settingsAnchors.about };
    case 'managed-agents':
      return { tab: 'agents', anchor: id || settingsAnchors.managedSetup };
    case 'remote':
      return { tab: 'computers', anchor: id };
    // The Updates tab was removed. The runtime and the SSH helpers update in Computers.
    case 'updates':
      return { tab: 'computers', anchor: id || runtimeAnchor() };
    default:
      return { tab: isSettingsTab(section) ? section : 'general', anchor: id };
  }
}
