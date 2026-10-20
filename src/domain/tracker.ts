/** Shared tracker domain. Provider-native identifiers remain opaque strings. */
export interface TrackerProject {
  id: string;
  title: string;
  url: string;
  owner?: string;
  number?: number;
  statusFieldId?: string;
}
export interface TrackerField {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string }[];
  iterations?: { id: string; title: string; startDate: string; duration: number }[];
  raw: Record<string, unknown>;
}
export interface TrackerItem {
  id: string;
  title: string;
  body: string;
  url?: string;
  repository?: string;
  number?: number;
  status?: string;
  statusId?: string;
  kind?: string;
  archived?: boolean;
  fieldValues?: Record<string, unknown>[];
}
export interface TrackerBoard {
  cache?: { revision: string; fetchedAt: number };
  project: TrackerProject;
  items: TrackerItem[];
  archivedItems?: TrackerItem[];
  restrictedItems?: number;
  writable?: boolean;
  fields?: TrackerField[];
  statusField?: { id: string; options: { id: string; name: string }[] };
}
export interface TrackerOwner {
  id: string;
  login: string;
  kind: 'user' | 'organization' | 'team';
}
export interface TrackerAuthState {
  status:
    | 'idle'
    | 'checking'
    | 'waiting'
    | 'verifying'
    | 'ready'
    | 'signed-out'
    | 'permission-required'
    | 'expired'
    | 'canceled'
    | 'error';
  attemptId?: string;
  reason?: 'missing-cli' | 'network' | 'sso' | 'token-override' | 'permissions' | 'verification';
  code?: string;
  message?: string;
}
export function trackerAuthPending(state: TrackerAuthState) {
  return ['checking', 'waiting', 'verifying'].includes(state.status);
}
export interface TrackerCapabilities {
  createProject: boolean;
  createItem: boolean;
  importItem: boolean;
  updateStatus: boolean;
}
export interface TrackerDescriptor {
  id: string;
  name: string;
  capabilities: TrackerCapabilities;
  statusNames: { progress: string; done: string };
}
export interface TrackerConnection {
  provider: string;
  project: TrackerProject;
  statusMapping?: Partial<Record<'progress' | 'done', string>>;
  statusFieldId?: string;
}
export function trackerConnection(
  group: { tracker?: TrackerConnection; github?: TrackerProject } | undefined,
): TrackerConnection | undefined {
  return (
    group?.tracker || (group?.github ? { provider: 'github', project: group.github } : undefined)
  );
}
export const githubDescriptor: TrackerDescriptor = {
  id: 'github',
  name: 'GitHub',
  capabilities: { createProject: true, createItem: true, importItem: true, updateStatus: true },
  statusNames: { progress: 'In progress', done: 'Done' },
};

/** Validate persisted adapter data without requiring the adapter to be installed. */
export function isTrackerConnection(value: unknown): value is TrackerConnection {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TrackerConnection>;
  if (typeof v.provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(v.provider)) return false;
  const project = v.project;
  if (
    !project ||
    !['id', 'title', 'url'].every(
      (key) => typeof project[key as keyof TrackerProject] === 'string',
    ) ||
    !project.id ||
    !project.url
  )
    return false;
  if (
    v.statusFieldId !== undefined &&
    (typeof v.statusFieldId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(v.statusFieldId))
  )
    return false;
  return (
    v.statusMapping === undefined ||
    (v.statusMapping !== null &&
      typeof v.statusMapping === 'object' &&
      !Array.isArray(v.statusMapping) &&
      Object.entries(v.statusMapping).every(
        ([key, value]) => ['progress', 'done'].includes(key) && typeof value === 'string',
      ))
  );
}
