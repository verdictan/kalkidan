/**
 * What Kalkidan keeps, where, for how long, and who removes it. The text describes what the
 * code stores. Keep it aligned with `docs/data-and-retention.md`.
 */

/** The disk limit of the Kalkidan data folder (`~/.kalkidan`): 2 GB. */
export const localDataLimitBytes = 2_000_000_000;
/** Kalkidan checks the disk limit at launch and then at this interval. */
export const localDataCheckIntervalMs = 6 * 60 * 60 * 1000;
/** The longest time that a running runtime continues after a revocation while it is online. */
export const revocationOnlineDelaySeconds = 10;
/** The longest time that a runtime continues after a revocation while it is offline. */
export const revocationOfflineDelaySeconds = 300;

/** The kinds of local data in the data folder. */
export type LocalDataCategory =
  'chat-history' | 'projects' | 'browser' | 'settings' | 'runtime' | 'caches' | 'logs' | 'other';
/** The kinds of local data that the user can delete in Settings › Data. */
export type LocalDataDeletion = 'chat-history' | 'caches-and-logs';

export interface LocalDataUsage {
  root: string;
  total: number;
  limit: number;
  categories: { category: LocalDataCategory; bytes: number }[];
}
export interface LocalDataExport {
  /** The new folder that holds the export. */
  path: string;
  files: number;
}
export interface LocalDataLimitResult {
  before: number;
  after: number;
  limit: number;
  removed: string[];
  overLimit: boolean;
}

export const localDataLabels: Record<LocalDataCategory, string> = {
  'chat-history': 'Chat history',
  projects: 'Projects',
  browser: 'Preview browser',
  settings: 'Settings',
  runtime: 'Verdictan runtime',
  caches: 'Caches',
  logs: 'Logs',
  other: 'Other',
};

/** One part of the data notice: a title and short statements. */
export interface DisclosureSection {
  id: 'execution-host' | 'provider' | 'verdictan';
  title: string;
  items: string[];
}

/**
 * The data notice. Kalkidan shows it once before the first request, and Settings › Data shows
 * it again. Each statement agrees with what the code sends and stores.
 */
export const dataDisclosure: DisclosureSection[] = [
  {
    id: 'execution-host',
    title: 'Stays on the execution host',
    items: [
      'The execution host is this computer or the SSH host where the agent runs.',
      'Your repositories and code stay there. The agent reads and changes files there.',
      'Agent conversations stay there: prompts, replies, tool output, and file content that the agent reads.',
      'Project documents, project memory, worktrees, session notes, and operation records stay there.',
      'Runtime credentials stay in memory only. They expire in 15 minutes or less.',
    ],
  },
  {
    id: 'provider',
    title: 'Goes to the model provider',
    items: [
      'Each model request goes through the Verdictan gateway to the provider that you selected.',
      'A request contains your prompt, the conversation so far, the agent instructions, tool results, and the file content that the agent includes.',
      'The request also contains the model name and the request settings.',
      'With a Claude or ChatGPT subscription, your subscription token goes to that provider.',
      'Your Verdictan account credentials never go to the provider.',
    ],
  },
  {
    id: 'verdictan',
    title: 'Verdictan keeps in your selected region',
    items: [
      'Verdictan keeps your data in the region that you selected (EU or US).',
      'It keeps your account, organization, devices, and hosts, and your sign-in sessions with IP address and user agent.',
      'For each model request, it keeps the policy decision, a hash of the prompt, the provider, the model, token counts, cost, and request identifiers.',
      'By default, History keeps metadata only. If an administrator sets full capture, Verdictan also keeps prompts and replies.',
      'It keeps project context that you publish to project services, and your search queries.',
      'It keeps an audit trail of account and Console changes for 90 days.',
    ],
  },
];

/** Where a store is, and who removes it. */
export type StoreLocation = 'local' | 'ssh-host' | 'verdictan';
export interface StorePolicy {
  id: string;
  location: StoreLocation;
  name: string;
  path: string;
  contents: string;
  retention: string;
  limit: string;
  export: string;
  deletion: string;
}

/** The retention, limit, export, and deletion of each store. */
export const storePolicies: StorePolicy[] = [
  {
    id: 'local-chat-history',
    location: 'local',
    name: 'Chat history',
    path: '~/.kalkidan/managed-agent-homes, sessions.json, chat-outcomes.json, verdictan-bindings.json',
    contents: 'Agent transcripts, session titles and notes, run outcomes, and conversation links.',
    retention: 'Until you delete it. Kalkidan never removes it automatically.',
    limit: 'Counts toward the 2 GB limit. Run outcomes keep the newest 2000 entries.',
    export: 'Settings › Data › Export',
    deletion: 'Settings › Data › Delete chat history',
  },
  {
    id: 'local-projects',
    location: 'local',
    name: 'Projects',
    path: '~/.kalkidan/projects, docs, projects.json, project-groups.json',
    contents: 'Project documents, project memory, clones, and worktrees that Kalkidan made.',
    retention: 'Until you remove the project. Deleted documents stay in docs/.trash.',
    limit: 'Counts toward the 2 GB limit. Memory: 200 entries and 1 MiB for each project.',
    export: 'Documents and memory: Settings › Data › Export',
    deletion: 'Remove the project. Kalkidan does not delete a folder that you selected.',
  },
  {
    id: 'local-browser',
    location: 'local',
    name: 'Preview browser',
    path: '~/.kalkidan/browser, Partitions/kalkidan-preview',
    contents: 'Visited pages, downloads, site data, cookies, and imported passwords (encrypted).',
    retention: 'The newest 500 visits and 100 downloads.',
    limit: 'Counts toward the 2 GB limit.',
    export: 'History and downloads: Settings › Data › Export',
    deletion: 'Preview browser › Clear browsing data',
  },
  {
    id: 'local-caches-logs',
    location: 'local',
    name: 'Caches and logs',
    path: '~/.kalkidan/Cache and other Chromium caches, operations, unused runtime versions',
    contents: 'Chromium caches, operation receipts, and old Verdictan runtime versions.',
    retention: 'Kalkidan removes the oldest first when the data folder is above 2 GB.',
    limit: 'Removed first at the 2 GB limit. Logs newer than 24 hours stay.',
    export: 'Operation receipts: Settings › Data › Export',
    deletion: 'Settings › Data › Delete caches and logs',
  },
  {
    id: 'local-settings-runtime',
    location: 'local',
    name: 'Settings and runtime',
    path: '~/.kalkidan/preferences.json, remote-hosts.json, verdictan-region.json, runtime/verdictan',
    contents:
      'Your choices, the SSH host list (no keys), the region, and the active and previous runtime.',
    retention: 'Until uninstall.',
    limit: 'Counts toward the 2 GB limit.',
    export: 'Settings files: Settings › Data › Export',
    deletion: 'Delete the ~/.kalkidan folder after you quit Kalkidan.',
  },
  {
    id: 'local-event-buffer',
    location: 'local',
    name: 'Event buffer',
    path: 'The local event buffer of Kalkidan',
    contents: 'Usage records and other events that Verdictan did not receive yet.',
    retention: '30 days.',
    limit:
      '200 MB. When it is full, the oldest events that are not usage records go first. Usage records stay until Verdictan receives them.',
    export: 'Not exported.',
    deletion: 'Removed after delivery or after 30 days.',
  },
  {
    id: 'ssh-host-data',
    location: 'ssh-host',
    name: 'SSH host data',
    path: '~/.local/share/kalkidan/agents and ~/.kalkidan on the host',
    contents:
      'The Kalkidan helper, the host runtime, agent transcripts, and records of work on that host.',
    retention: 'Until you remove the host and select to delete its Kalkidan data.',
    limit: '2 GB for ~/.kalkidan on the host, with the same rules.',
    export: 'Not exported from the desktop. Copy the folder on the host.',
    deletion: 'Settings › Computers › Remove host › Delete Kalkidan data on the host',
  },
  {
    id: 'verdictan-account',
    location: 'verdictan',
    name: 'Account, devices, and sessions',
    path: 'Verdictan, selected region',
    contents: 'Account, organization membership, device and host identifiers, sign-in sessions.',
    retention: 'Until the account or organization is deleted. A revoked host stays blocked.',
    limit: 'Not applicable.',
    export: 'Console',
    deletion: 'Console › Devices and hosts, or organization deletion',
  },
  {
    id: 'verdictan-requests',
    location: 'verdictan',
    name: 'Request records',
    path: 'Verdictan, selected region',
    contents: 'Policy decisions, prompt hashes, usage, cost, and History metadata.',
    retention: 'Audit events and History: 730 days in the EU and 2555 days in the US, by default.',
    limit: 'Not applicable.',
    export: 'Console › History and exports',
    deletion: 'Removed at the end of the retention period, or by organization deletion.',
  },
];

/** The effect of each end-of-use action. */
export const lifecycleEffects: { action: string; effect: string }[] = [
  {
    action: 'Remove an SSH host',
    effect:
      'Kalkidan revokes the host in Verdictan and disconnects it. When you select it, Kalkidan deletes the Kalkidan data on the host. Project folders on the host stay.',
  },
  {
    action: 'Revoke a device or host in the Console',
    effect: `Kalkidan stops the runtime within ${revocationOnlineDelaySeconds} seconds while it is online, and within ${revocationOfflineDelaySeconds / 60} minutes when it is offline. A revoked device signs out. Local data stays.`,
  },
  {
    action: 'Leave or lose an organization',
    effect:
      'Verdictan revokes the API credentials that you made in that organization. Local data stays until you delete it.',
  },
  {
    action: 'Delete the organization',
    effect:
      'Verdictan deletes the organization data 30 days after the request. The billing ledger stays.',
  },
  {
    action: 'Uninstall Kalkidan',
    effect:
      'Removing the app does not delete ~/.kalkidan. Delete your data in Settings › Data first, or delete the folder after you quit Kalkidan.',
  },
];

/** The state of the data notice. */
export interface DataNoticeState {
  /** True after the user read the data notice once. */
  seen: boolean;
}

/** The IPC methods of local data control. Each is absent in the browser preview. */
export interface DataControlAPI {
  dataNoticeState?(): Promise<DataNoticeState>;
  setDataNoticeSeen?(): Promise<DataNoticeState>;
  localDataUsage?(): Promise<LocalDataUsage>;
  /** Asks for a folder and exports to it. Null when the user cancels. */
  localDataExport?(): Promise<LocalDataExport | null>;
  /** Deletes local data of one kind. It refuses while an agent runs. */
  localDataDelete?(kind: LocalDataDeletion): Promise<{ removed: string[] }>;
  /** Applies the disk limit now. */
  localDataEnforceLimit?(): Promise<LocalDataLimitResult>;
}
