/** The sections of the Settings dialog, in order. */
export type SettingsSection =
  'general' | 'account' | 'agents' | 'computers' | 'diagnostics' | 'about';

/**
 * A section name that other parts of the app can send. It includes the names of the older
 * Settings page tabs ('accounts' and 'updates'). `settingsTarget` maps them to a section.
 */
export type SettingsTab = SettingsSection | 'accounts' | 'updates';

export const settingsSections: { value: SettingsSection; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'account', label: 'Account' },
  { value: 'agents', label: 'Agents' },
  { value: 'computers', label: 'Computers' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'about', label: 'About' },
];

/** @deprecated Use `settingsSections`. */
export const settingsTabs = settingsSections;

export function isSettingsSection(value: unknown): value is SettingsSection {
  return settingsSections.some((section) => section.value === value);
}

/** @deprecated Use `isSettingsSection`. */
export const isSettingsTab = isSettingsSection;

/** The label of a section, for example "Computers". An older tab name gets its new label. */
export function settingsTabLabel(tab: SettingsTab | string) {
  const section = settingsTarget(tab).tab;
  return settingsSections.find((item) => item.value === section)?.label || 'General';
}

/** The element ID of one computer in Settings › Computers. No host ID means this computer. */
export function computerAnchor(hostId?: string) {
  return `computer-${hostId || 'local'}`;
}

/** The element ID of the managed runtime of one computer in Settings › Computers. */
export function runtimeAnchor(hostId?: string) {
  return `runtime-${hostId || 'local'}`;
}

/** The element ID of the "…" menu of one SSH host in Settings › Computers. */
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
  notifications: 'settings-notifications',
  services: 'settings-connected-services',
} as const;

/** The section of each anchor that is not a computer, runtime, or agent anchor. */
const anchorSections: Record<string, SettingsSection> = {
  [settingsAnchors.account]: 'account',
  [settingsAnchors.region]: 'account',
  [settingsAnchors.services]: 'account',
  [settingsAnchors.managedSetup]: 'agents',
  [settingsAnchors.defaultAgent]: 'general',
  [settingsAnchors.notifications]: 'general',
  [settingsAnchors.about]: 'about',
};

/** The older section and tab names, and the section that now holds each one. */
const legacySections: Record<string, SettingsSection> = {
  accounts: 'account',
  'managed-agents': 'agents',
  remote: 'computers',
  'remote-hosts': 'computers',
};

/**
 * The section and the element that get focus for a request to open Settings. The request can
 * use the names of older sections and tabs: 'accounts', 'managed-agents', 'updates', 'remote',
 * and 'remote-hosts'. A known anchor selects its own section, so an older name with a moved
 * anchor still opens the anchor.
 */
export function settingsTarget(
  section?: string,
  anchor?: string,
): { tab: SettingsSection; anchor?: string } {
  // The runtime moved from Managed agents to the row of this computer in Computers.
  const id = anchor === 'verdictan-runtime' ? runtimeAnchor() : anchor || undefined;
  if (id) {
    if (anchorSections[id]) return { tab: anchorSections[id], anchor: id };
    if (id.startsWith('computer-') || id.startsWith('runtime-') || id.startsWith('helper-update-'))
      return { tab: 'computers', anchor: id };
    if (id === 'settings-agents' || id.startsWith('agent-')) return { tab: 'agents', anchor: id };
  }
  if (section === 'managed-agents')
    return { tab: 'agents', anchor: id || settingsAnchors.managedSetup };
  // The Updates tab was removed. Kalkidan does not update itself. The runtime and the SSH
  // helpers update in Computers.
  if (section === 'updates') return { tab: 'computers', anchor: id || runtimeAnchor() };
  if (section && legacySections[section]) return { tab: legacySections[section], anchor: id };
  return { tab: isSettingsSection(section) ? section : 'general', anchor: id };
}
