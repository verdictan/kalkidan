export interface RelatedIssue {
  id: string;
  title: string;
  url: string;
  state: string;
}
export interface IssueRelations {
  issueId: string;
  revision: string;
  writable: boolean;
  parent: RelatedIssue | null;
  subIssues: RelatedIssue[];
  blockedBy: RelatedIssue[];
  blocking: RelatedIssue[];
}
export type IssueRelationAction =
  | { kind: 'add-child'; url: string }
  | { kind: 'add-blocker'; url: string }
  | { kind: 'remove-child'; id: string }
  | { kind: 'remove-blocker'; id: string }
  | { kind: 'move-child'; id: string; beforeId: string };
export interface GitHubRelationsAPI {
  trackerRelations(group: string, item: string): Promise<IssueRelations>;
  trackerRelationChange(
    group: string,
    item: string,
    revision: string,
    action: IssueRelationAction,
  ): Promise<IssueRelations>;
}
