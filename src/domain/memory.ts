export interface ProjectMemory {
  pages: {
    topic?: string;
    provenance?: string;
    name: string;
    content: string;
    updatedAt: string;
    truncated: boolean;
  }[];
  limited: boolean;
  extraction?: MemoryExtraction;
}

export interface MemoryExtraction {
  id: string;
  turnId: string;
  status: 'queued' | 'extracting' | 'validating' | 'saved' | 'skipped' | 'failed';
  updatedAt: string;
  saved?: number;
  error?: string;
}

export interface MemorySource {
  id: string;
  text: string;
}
export interface MemoryEntry {
  version: 1;
  id: string;
  topic: string;
  content: string;
  revision: string;
  /**
   * `verified`: an agent saved it with exact quotes from a chat. `user`: the user wrote or
   * edited it in Memory; it has no chat references. Agents read both the same way. `external`:
   * the file changed outside Kalkidan. `legacy`: a file from before managed memory.
   */
  provenance: 'verified' | 'user' | 'legacy' | 'external';
  source: { sessionId: string; turnId: string; references: { id: string; quote: string }[] };
  createdAt: string;
  updatedAt: string;
  supersedes: string[];
}
export interface MemoryCandidate {
  id?: string;
  expectedRevision?: string;
  topic: string;
  content: string;
  references: { id: string; quote: string }[];
  supersedes?: { id: string; revision: string }[];
}
export type MemoryWriteResult =
  | { status: 'saved' | 'duplicate'; entry: MemoryEntry }
  | { status: 'conflict'; id: string; revision: string }
  | { status: 'deferred'; reason: string };

/** What an agent read in one chat. */
export interface ContextUsage {
  memory: { id: string; topic: string; title?: string }[];
  docs: { docId: string; title: string; heading?: string }[];
}
