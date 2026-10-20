export type ProjectResourceKind =
  'issueFields' | 'fields' | 'views' | 'statusUpdates' | 'workflows';
export type ProjectResourceOperation =
  | 'createConfiguredProjectView'
  | 'createProjectV2IssueField'
  | 'createProjectV2Field'
  | 'updateProjectV2Field'
  | 'deleteProjectV2Field'
  | 'createProjectV2View'
  | 'updateProjectV2View'
  | 'deleteProjectV2View'
  | 'createProjectV2StatusUpdate'
  | 'updateProjectV2StatusUpdate'
  | 'deleteProjectV2StatusUpdate'
  | 'deleteProjectV2Workflow';
export interface ProjectResourceSnapshot {
  projectId: string;
  kind: ProjectResourceKind;
  writable: boolean;
  revision: string;
  records: Record<string, unknown>[];
}
export interface SavedProjectView {
  id: string;
  name: string;
  filter: string;
  layout: 'TABLE_LAYOUT' | 'BOARD_LAYOUT' | 'ROADMAP_LAYOUT';
  itemIds: string[];
  visibleFieldIds?: string[];
  groupFieldIds?: string[];
  columnFieldIds?: string[];
  sortFields?: { id: string; direction: 'ASC' | 'DESC' }[];
}
export interface GitHubResourcesAPI {
  trackerSavedView(groupId: string, viewId: string): Promise<SavedProjectView>;
  trackerResources(groupId: string, kind: ProjectResourceKind): Promise<ProjectResourceSnapshot>;
  trackerResourceChange(
    groupId: string,
    revision: string,
    operation: ProjectResourceOperation,
    input: Record<string, unknown>,
  ): Promise<ProjectResourceSnapshot>;
}
