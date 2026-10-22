/**
 * The older sections of the Settings dialog. Other parts of the app still send these names.
 * `settingsPlace` maps each name and anchor to the place that now holds it.
 */
export type SettingsSection = 'general' | 'account' | 'agents' | 'computers' | 'about';

/**
 * A section name that other parts of the app can send. It includes the names of the older
 * Settings page tabs ('accounts' and 'updates'). `settingsTarget` maps them to a section.
 */
export type SettingsTab = SettingsSection | 'accounts' | 'updates';

/** @deprecated The Settings sections are gone. Use `settingsPlace`. */
export const settingsSections: { value: SettingsSection; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'account', label: 'Account' },
  { value: 'agents', label: 'Agents' },
  { value: 'computers', label: 'Computers' },
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
  /** The GitHub row of Preferences. */
  github: 'settings-github',
  /** The agent rows of the Computers page. */
  agents: 'settings-agents',
  /** The "Your data" row of Preferences: the data notice, disk use, export, and deletion. */
  data: 'settings-data',
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

/**
 * The places that hold the settings now:
 * - 'preferences': the Preferences sheet (⌘,). It has the chat rows, the region, GitHub, the
 *   built-in browser, your data, and the version.
 * - 'computers': the Computers page. It has this computer, the agents with their programs and
 *   organization setup, and the SSH hosts.
 * - 'account-menu': the account menu in the sidebar footer. It has the theme, the
 *   notifications, and sign-out.
 */
export type SettingsPlace = 'preferences' | 'computers' | 'account-menu';

/** The anchors that the account menu holds. */
const accountMenuAnchors = new Set<string>([settingsAnchors.notifications]);
/** The anchors of Preferences. */
const preferenceAnchors = new Set<string>([
  settingsAnchors.region,
  settingsAnchors.github,
  settingsAnchors.about,
  settingsAnchors.data,
]);

/**
 * The place and the element to move to for a request to open Settings. It maps the older
 * sections and anchors:
 * - general, account, about, and the region, GitHub and version anchors → Preferences.
 * - agents, computers, remote, updates, managed-agents, and the computer, runtime, helper,
 *   agent and default-agent anchors → the Computers page.
 * - the notifications anchor → the account menu.
 * - the account anchor ('verdictan-account') → Preferences. A shell that is signed out starts
 *   the sign-in in place of it.
 */
export function settingsPlace(
  section?: string,
  anchor?: string,
): { place: SettingsPlace; anchor?: string } {
  const target = settingsTarget(section, anchor);
  const id = target.anchor;
  if (id && accountMenuAnchors.has(id)) return { place: 'account-menu' };
  // The connected services are now one GitHub row.
  if (id === settingsAnchors.services)
    return { place: 'preferences', anchor: settingsAnchors.github };
  if (id && preferenceAnchors.has(id)) return { place: 'preferences', anchor: id };
  if (id === settingsAnchors.account) return { place: 'preferences', anchor: id };
  if (id === settingsAnchors.defaultAgent)
    return { place: 'computers', anchor: settingsAnchors.agents };
  // The agents section without an element opens the agent rows.
  if (target.tab === 'agents') return { place: 'computers', anchor: id || settingsAnchors.agents };
  if (target.tab === 'computers') return { place: 'computers', anchor: id };
  return { place: 'preferences', anchor: id };
}
