/**
 * The files of a repository for the embedded code editor. All paths are relative to the
 * repository root and use "/". The desktop app keeps each path inside the root.
 */

/** The limits of the code editor. Sizes are bytes unless the name says other. */
export const codeFileLimits = {
  /** The maximum number of files in the file list. */
  files: 20000,
  /** A file larger than this opens as a note, not as text. */
  readBytes: 2 * 1024 * 1024,
  /** The maximum size of the text that a save writes. */
  writeBytes: 2 * 1024 * 1024,
  /** The maximum length of a relative path. */
  path: 1024,
  /** The maximum length of a search text. */
  query: 200,
  /** The maximum number of search results. */
  matches: 500,
  /** Search does not read files larger than this. */
  searchFileBytes: 1024 * 1024,
  /** The maximum length of the line text in a search result. */
  matchText: 240,
} as const;

/** The files of a repository: tracked and not ignored files for Git, else a bounded walk. */
export interface CodeFileList {
  files: string[];
  /** True when the repository has more files than the list. */
  truncated: boolean;
}

/**
 * A file of the repository. `content` is empty when the file is binary or too large, and
 * `note` then says why. `revision` identifies the content on disk (a SHA-256 of the bytes).
 */
export interface CodeFile {
  path: string;
  size: number;
  revision: string;
  content?: string;
  note?: 'binary' | 'too-large';
}

/**
 * The result of a save. `conflict`: the file on disk is not the revision that the editor
 * opened. Nothing was written. `revision` is the revision on disk (null: the file is gone).
 */
export type CodeFileWriteResult =
  | { ok: true; revision: string; size: number }
  | { ok: false; conflict: true; revision: string | null };

/** The lines of a file that are different from the last commit (1-based, new file side). */
export interface CodeLineChanges {
  path: string;
  /** Added or changed lines. A file that Git does not track gives all its lines. */
  lines: number[];
  /** True when the file is new (not in the last commit). */
  untracked: boolean;
}

/** One line that contains the search text. `line` and `column` are 1-based. */
export interface CodeSearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface CodeSearchResult {
  matches: CodeSearchMatch[];
  /** True when there are more matches than the result. */
  truncated: boolean;
}

/**
 * The code editor API. `hostId` is the SSH host of the repository; no host ID means this
 * computer. `cwd` must be a folder of a project.
 */
export interface CodeFilesAPI {
  codeFiles?(cwd: string, hostId?: string): Promise<CodeFileList>;
  codeFileRead?(cwd: string, path: string, hostId?: string): Promise<CodeFile>;
  /** Writes only when the file on disk is still `expectedRevision`. */
  codeFileWrite?(
    cwd: string,
    path: string,
    content: string,
    expectedRevision: string,
    hostId?: string,
  ): Promise<CodeFileWriteResult>;
  /** The revision on disk, or null when the file is gone. */
  codeFileRevision?(cwd: string, path: string, hostId?: string): Promise<string | null>;
  codeFileChanges?(cwd: string, path: string, hostId?: string): Promise<CodeLineChanges>;
  /** Finds the text in the files of the repository. Case-insensitive unless it has capitals. */
  codeSearch?(cwd: string, query: string, hostId?: string): Promise<CodeSearchResult>;
}

/**
 * Checks a repository path from the renderer or from IPC. Returns the path with "/" separators,
 * or null when it is absolute, goes up, is in `.git`, or is too long.
 */
export function cleanCodePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > codeFileLimits.path) return null;
  if (value.includes('\0') || value.startsWith('/') || value.startsWith('\\')) return null;
  if (/^[A-Za-z]:/.test(value)) return null;
  const parts = value.split(/[\\/]/);
  if (parts.some((part) => part === '..' || part.toLowerCase() === '.git')) return null;
  const clean = parts.filter((part) => part && part !== '.');
  return clean.length ? clean.join('/') : null;
}
