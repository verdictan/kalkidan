import type { Session } from './conversation';
export interface HistoryImportPreview {
  sessions: (Session & { available: boolean; missingFolder: boolean })[];
  warnings: string[];
  sources: { codex: string; claude: string };
}
export interface HistoryImportRequest {
  groupId: string;
  sessions: { agent: Session['agent']; id: string }[];
  collection?: string;
}
export interface HistoryImportResult {
  imported: number;
  repositories: number;
  skipped: string[];
}
