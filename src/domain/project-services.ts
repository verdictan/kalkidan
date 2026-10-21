/** Proposed broker contract; support requires an advertised runtime capability. */
export const projectServicePermissions = {
  'task.history': 'history.read',
  'review.list': 'review.read',
  'review.decide': 'review.decide',
  'context.settings': 'context.read',
  'context.configure': 'context.configure',
  'context.search': 'context.read',
  'context.list': 'context.read',
  'context.publish': 'context.publish',
  'context.delete': 'context.delete',
  'admin.templates': 'templates.read',
  'admin.template.save': 'templates.manage',
  'admin.template.apply': 'templates.apply',
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
