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
  provenance: 'verified' | 'legacy' | 'external';
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
