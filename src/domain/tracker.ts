/** Shared tracker domain. Provider-native identifiers remain opaque strings. */
export interface TrackerProject {
  id: string;
  title: string;
  url: string;
  owner?: string;
  number?: number;
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
}
export interface TrackerBoard {
  project: TrackerProject;
  items: TrackerItem[];
  statusField?: { id: string; options: { id: string; name: string }[] };
}
export interface TrackerOwner {
  id: string;
  login: string;
  kind: 'user' | 'organization' | 'team';
}
export interface TrackerAuthState {
  status: 'idle' | 'checking' | 'waiting' | 'ready' | 'error';
  code?: string;
  message?: string;
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
