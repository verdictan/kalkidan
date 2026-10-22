import { checkAgentVersion, nativeAgentKind } from './agent-version';

/**
 * The one Settings window (⌘,) has these sections: General, Computers, Account, and one
 * section for each project. `settingsPane` maps every older section name and anchor to one of
 * them, so that older links still open the right place.
 */
export type SettingsPane = 'general' | 'computers' | 'account' | `project:${string}`;

/**
 * A section name that other parts of the app can send. It includes the names of the older
 * sections ('agents' and 'about') and the section of a project ('project:<id>').
 */
export type SettingsSection =
  'general' | 'account' | 'agents' | 'computers' | 'about' | `project:${string}`;

/**
 * A section name that other parts of the app can send. It includes the names of the older
 * Settings page tabs ('accounts' and 'updates'). `settingsTarget` maps them to a section.
 */
export type SettingsTab = SettingsSection | 'accounts' | 'updates';

/** The fixed sections of Settings, in the order of the nav. Projects follow them. */
export const settingsPanes: { value: 'general' | 'computers' | 'account'; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'computers', label: 'Computers' },
  { value: 'account', label: 'Account' },
];

/** @deprecated The older sections. Use `settingsPanes`. */
export const settingsSections: { value: SettingsSection; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'account', label: 'Account' },
  { value: 'agents', label: 'Agents' },
  { value: 'computers', label: 'Computers' },
  { value: 'about', label: 'About' },
];

/** @deprecated Use `settingsSections`. */
export const settingsTabs = settingsSections;

/** True for the older fixed section names. A project section is not one of them. */
export function isSettingsSection(value: unknown): value is SettingsSection {
  return settingsSections.some((section) => section.value === value);
}

/** @deprecated Use `isSettingsSection`. */
export const isSettingsTab = isSettingsSection;

/** The section of one project. */
export function projectPane(groupId: string): SettingsPane {
  return `project:${groupId}`;
}

/** The project ID of a project section, or undefined for the other sections. */
export function paneGroupId(pane: string | undefined) {
  return pane?.startsWith('project:') ? pane.slice('project:'.length) || undefined : undefined;
}

/** The label of a section, for example "Computers". An older name gets the label of its pane. */
export function settingsTabLabel(tab: SettingsTab | string) {
  const pane = settingsPane(tab).pane;
  return settingsPanes.find((item) => item.value === pane)?.label || 'General';
}

/** The element ID of one computer in Settings › Computers. No host ID means this computer. */
export function computerAnchor(hostId?: string) {
  return `computer-${hostId || 'local'}`;
}

/** The element ID of the agent row of one computer in Settings › Computers. */
export function computerAgentAnchor(hostId?: string) {
  return `agent-${hostId || 'local'}`;
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
  /** The GitHub row of Settings › Account. */
  github: 'settings-github',
  /** The agent rows of Settings › Computers. */
  agents: 'settings-agents',
  /** The "Your data" row of Settings › General: disk use, export, and deletion. */
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
 * The older section and the element that get focus for a request to open Settings. The request
 * can use the names of older sections and tabs: 'accounts', 'managed-agents', 'updates',
 * 'remote', and 'remote-hosts'. A known anchor selects its own section. A project section
 * ('project:<id>') passes through with its anchor. Use `settingsPane` for the section that
 * shows now.
 */
export function settingsTarget(
  section?: string,
  anchor?: string,
): { tab: SettingsSection; anchor?: string } {
  if (paneGroupId(section)) return { tab: section as SettingsSection, anchor: anchor || undefined };
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

/** The pane of each older section. */
const sectionPanes: Record<string, SettingsPane> = {
  general: 'general',
  about: 'general',
  account: 'account',
  agents: 'computers',
  computers: 'computers',
};

/**
 * The section of the one Settings window and the element to move to, for a request to open
 * Settings. Every older section name and anchor maps to its new place:
 * - general, about, and the version, data and notifications anchors → General.
 * - account, accounts, and the account, region, GitHub and connected-services anchors →
 *   Account. The connected services are now one GitHub row.
 * - agents, computers, remote, remote-hosts, updates, managed-agents, and the computer,
 *   runtime, agent, default-agent, helper and organization setup anchors → Computers.
 * - 'project:<id>' → the section of that project. Its anchor names a part of the project
 *   section, for example 'board' or 'roadmap-dates'.
 */
export function settingsPane(
  section?: string,
  anchor?: string,
): { pane: SettingsPane; anchor?: string } {
  if (paneGroupId(section)) return { pane: section as SettingsPane, anchor: anchor || undefined };
  const target = settingsTarget(section, anchor);
  const id = target.anchor;
  // The default agent is now the agent rows. The connected services are now the GitHub row.
  if (id === settingsAnchors.defaultAgent)
    return { pane: 'computers', anchor: settingsAnchors.agents };
  if (id === settingsAnchors.services) return { pane: 'account', anchor: settingsAnchors.github };
  if (id === settingsAnchors.github) return { pane: 'account', anchor: id };
  if (id === settingsAnchors.data) return { pane: 'general', anchor: id };
  // The agents section without an element opens the agent rows.
  if (target.tab === 'agents') return { pane: 'computers', anchor: id || settingsAnchors.agents };
  return { pane: sectionPanes[target.tab] || 'general', anchor: id };
}

/**
 * @deprecated Settings has one place now. Use `settingsPane`. Every request goes to the one
 * Settings window ('preferences'); the 'computers' and 'account-menu' places are not used.
 */
export type SettingsPlace = 'preferences' | 'computers' | 'account-menu';

/**
 * @deprecated Use `settingsPane`. Every request opens the one Settings window. The anchor is
 * the anchor that `settingsPane` gives.
 */
export function settingsPlace(
  section?: string,
  anchor?: string,
): { place: SettingsPlace; anchor?: string } {
  return { place: 'preferences', anchor: settingsPane(section, anchor).anchor };
}

/** The part of an agent check that `agentNeedsUser` reads. */
interface AgentCheck {
  agent: string;
  status: 'installed' | 'missing' | 'unavailable';
  version?: string;
}

/**
 * True when the user must act for this coding agent: it is not installed, or its version is
 * older than the minimum. An agent that the app cannot check (the browser preview) does not
 * need the user, and neither does a version that Kalkidan cannot read.
 */
export function agentNeedsUser(check: AgentCheck | undefined) {
  if (!check || check.status === 'unavailable') return false;
  if (check.status === 'missing') return true;
  const kind = nativeAgentKind(check.agent);
  return !!kind && checkAgentVersion(kind, check.version).status === 'outdated';
}

/** True when Settings › Computers has something for the user: the avatar and the nav show a dot. */
export function computersNeedUser(checks: AgentCheck[] | undefined, runtimeFailed = false) {
  return runtimeFailed || !!checks?.some((check) => agentNeedsUser(check));
}
