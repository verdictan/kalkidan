/**
 * Project operations of the broker. Each one needs an advertised runtime capability. History uses
 * `history.list`, which is not a project operation. Verdictan removed the template operations.
 */
export const projectServicePermissions = {
  'review.list': 'review.read',
  'review.decide': 'review.decide',
  'context.settings': 'context.read',
  'context.configure': 'context.configure',
  'context.search': 'context.read',
  'context.list': 'context.read',
  'context.publish': 'context.publish',
  'context.delete': 'context.delete',
  'operation.inspect': 'operations.read',
} as const;
export type ProjectServiceOperation = keyof typeof projectServicePermissions;
export interface ProjectServiceRequest {
  operation: ProjectServiceOperation;
  fields: Record<string, unknown>;
}
export interface ProjectServiceResult {
  project_scope: { organization_id: string; project_id: string };
  actor_id: string;
  revision: string;
  observed_at: string;
  [key: string]: unknown;
}
export interface ProjectServicesStatus {
  pendingOperations?: { id: string; operation: ProjectServiceOperation; state: string }[];
  available: boolean;
  operations: ProjectServiceOperation[];
  permissions: string[];
  /** True when the runtime advertises `history.list`. It needs no project permissions check. */
  historyList?: boolean;
  message?: string;
}
export interface ProjectServicesAPI {
  projectPublishDoc(
    groupId: string,
    docId: string,
    docRevision: string,
    operationId: string,
    expectedRevision: string,
  ): Promise<ProjectServiceResult>;
  projectServicesStatus(groupId: string): Promise<ProjectServicesStatus>;
  projectServicesRequest(
    groupId: string,
    request: ProjectServiceRequest,
  ): Promise<ProjectServiceResult>;
}
