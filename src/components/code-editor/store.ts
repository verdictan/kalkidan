import type { EditorState } from '@codemirror/state';

// The state of the code editor of each repository folder. It is outside React, so the open
// tabs, the unsaved text and your lines stay when the Code tab closes and opens again.

export interface CodeTab {
  path: string;
  /** The editor document. Undefined until the file is read. */
  state?: EditorState;
  loading: boolean;
  error?: string;
  note?: 'binary' | 'too-large';
  size?: number;
  /** The revision on disk that the text is based on. */
  revision: string;
  /** The text at the last read or save. */
  savedText: string;
  dirty: boolean;
  saving: boolean;
  /** True when the file differs from the last commit: the agent of the chat changed it. */
  agentChanged?: boolean;
  /** The file on disk changed while the tab has unsaved text. Null revision: the file is gone. */
  conflict?: { revision: string | null };
  /** The line to show when the document is ready (1-based). */
  goto?: { line: number; column?: number; n: number };
}

export interface CodeFolder {
  key: string;
  tabs: CodeTab[];
  active: string | null;
  /** Files opened in this folder, newest first. */
  recent: string[];
  /** The file list for go to file, and when it loaded. */
  files?: string[];
  filesAt?: number;
  filesError?: string;
}

export interface OpenFileRequest {
  path: string;
  line?: number;
  cwd?: string;
}

const folders = new Map<string, CodeFolder>();
const listeners = new Set<() => void>();
let version = 0;

export function folderKey(cwd: string, hostId?: string) {
  return `${hostId || ''}|${cwd}`;
}

export function codeFolder(key: string): CodeFolder {
  let folder = folders.get(key);
  if (!folder) {
    folder = { key, tabs: [], active: null, recent: [] };
    folders.set(key, folder);
  }
  return folder;
}

export function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeCode(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function codeVersion() {
  return version;
}

export function updateTab(key: string, path: string, patch: Partial<CodeTab>) {
  const folder = codeFolder(key);
  const tab = folder.tabs.find((item) => item.path === path);
  if (!tab) return;
  Object.assign(tab, patch);
  changed();
}

/** The paths of the folder with unsaved text. */
export function unsavedCodeFiles(cwd: string, hostId?: string): string[] {
  const folder = folders.get(folderKey(cwd, hostId));
  return folder ? folder.tabs.filter((tab) => tab.dirty).map((tab) => tab.path) : [];
}

// Requests to open a file. A request waits until an editor of its folder takes it.
let pending: OpenFileRequest[] = [];
const requestListeners = new Set<(request: OpenFileRequest) => void>();

/** Removes "a/" or "b/" of a diff header and a leading "./". */
export function requestPath(path: string) {
  return path.replace(/^[ab]\/(?=.)/, '').replace(/^\.\//, '');
}

/**
 * Opens a file of the repository at a line in the Code tab of the visible chat. `path` is
 * relative to the repository. Without `cwd`, the open editor takes the request.
 */
export function openFileAt(path: string, line?: number, cwd?: string) {
  const request = { path: requestPath(path), line, cwd };
  pending = [...pending.filter((item) => item.cwd !== cwd), request];
  for (const listener of requestListeners) listener(request);
  // The chat shows its Code tab for this event (conversation-tools.tsx, openCodeEvent).
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-code', { detail: { path: request.path, line, cwd } }),
  );
}

/** Calls the listener for each new request of `openFileAt`. */
export function onOpenFileRequest(listener: (request: OpenFileRequest) => void) {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}

/** Takes the waiting request for this folder, if there is one. */
export function takeOpenFileRequest(cwd: string): OpenFileRequest | undefined {
  const index = pending.findIndex((item) => !item.cwd || item.cwd === cwd);
  if (index < 0) return undefined;
  const [request] = pending.splice(index, 1);
  return request;
}
