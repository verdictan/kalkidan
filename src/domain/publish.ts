export interface PublishRequest {
  id: string;
  commit?: { message: string; files?: string[] };
  pullRequest?: { title: string; body: string };
}
export type PublishPhase =
  | 'ready'
  | 'committing'
  | 'committed'
  | 'publishing'
  | 'creating-pr'
  | 'completed'
  | 'failed'
  | 'unknown-outcome';
export interface PublishOperation {
  id: string;
  phase: PublishPhase;
  branch: string;
  before: string;
  commit?: string;
  url?: string;
  error?: string;
  updatedAt: number;
}
export interface PublishAPI {
  gitPublish(repositoryId: string, request: PublishRequest): Promise<PublishOperation>;
  gitPublishStatus(repositoryId: string, operationId: string): Promise<PublishOperation | null>;
}
