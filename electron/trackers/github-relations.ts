import { createHash } from 'node:crypto';
import type { GraphQL } from '../github-projects';
import type { GitHubProject } from '../../src/domain/github';
import type {
  IssueRelations,
  IssueRelationAction,
  RelatedIssue,
} from '../../src/domain/github-relations';
import { completeConnection } from './github-fields';
import { validateProjectMutation } from './github-schema';
import { GitHubRequestError } from './request-scheduler';
const selection = 'id title url state';
const connections = ['subIssues', 'blockedBy', 'blocking'] as const;
export class GitHubIssueRelations {
  private pending = new Set<string>();
  constructor(
    private query: GraphQL,
    private changed: () => void,
  ) {}
  async read(project: GitHubProject, item: string): Promise<IssueRelations> {
    const data = await this.query(
      `query($item:ID!){node(id:$item){... on ProjectV2Item{project{id viewerCanUpdate} content{... on Issue{${selection} viewerCanUpdate parent{${selection}}}}}}}`,
      { item },
    );
    const issue = data.node?.content;
    if (data.node?.project?.id !== project.id || !issue?.id)
      throw new Error('This issue is not accessible in this project.');
    const lists: Record<string, RelatedIssue[]> = {};
    for (const connection of connections) {
      const page = async (cursor?: string) => {
        const result = await this.query(
          `query($id:ID!,$cursor:String){node(id:$id){... on Issue{id ${connection}(first:100,after:$cursor){nodes{${selection}} pageInfo{hasNextPage endCursor}}}}}`,
          { id: issue.id, cursor },
        );
        if (result.node?.id !== issue.id) throw new Error('Issue access changed.');
        return result.node[connection];
      };
      lists[connection] = await completeConnection(await page(), page, 10000);
    }
    const value = {
      issueId: issue.id,
      writable: issue.viewerCanUpdate === true && data.node.project.viewerCanUpdate === true,
      parent: issue.parent || null,
      subIssues: lists.subIssues,
      blockedBy: lists.blockedBy,
      blocking: lists.blocking,
    };
    return { ...value, revision: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
  }
  async change(
    project: GitHubProject,
    item: string,
    revision: string,
    action: IssueRelationAction,
  ) {
    const key = `${project.id}:${item}`;
    if (this.pending.has(key)) throw new Error('An issue change is in progress.');
    if (
      !action ||
      !['add-child', 'add-blocker', 'remove-child', 'remove-blocker', 'move-child'].includes(
        action.kind,
      )
    )
      throw new Error('Invalid relationship action.');
    this.pending.add(key);
    try {
      const current = await this.read(project, item);
      if (!current.writable) throw new Error('You do not have permission to change this issue.');
      if (current.revision !== revision)
        throw new Error('Issue relationships changed. Reload before saving.');
      let method: string;
      let input: Record<string, unknown> = { issueId: current.issueId };
      if (action.kind === 'add-child' || action.kind === 'add-blocker') {
        const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/([1-9]\d*)$/.exec(
          action.url,
        );
        if (!match) throw new Error('Enter a GitHub issue URL.');
        const result = await this.query(
          'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id parent{id}}}}',
          { owner: match[1], name: match[2], number: Number(match[3]) },
        );
        const target = result.repository?.issue;
        if (!target?.id || target.id === current.issueId)
          throw new Error('Choose a different accessible issue.');
        if (action.kind === 'add-child') {
          if (target.parent?.id === current.issueId) return current;
          if (target.parent)
            throw new Error('Remove the existing parent before adding this child.');
          method = 'addSubIssue';
          input.subIssueId = target.id;
          input.replaceParent = false;
        } else {
          if (current.blockedBy.some((row) => row.id === target.id)) return current;
          method = 'addBlockedBy';
          input.blockingIssueId = target.id;
        }
      } else if (action.kind === 'remove-blocker') {
        if (!current.blockedBy.some((row) => row.id === action.id))
          throw new Error('The blocker is not linked to this issue.');
        method = 'removeBlockedBy';
        input.blockingIssueId = action.id;
      } else {
        if (!current.subIssues.some((row) => row.id === action.id))
          throw new Error('The child is not linked to this issue.');
        input.subIssueId = action.id;
        if (action.kind === 'move-child') {
          if (
            action.beforeId === action.id ||
            !current.subIssues.some((row) => row.id === action.beforeId)
          )
            throw new Error('Choose a different child for the position.');
          method = 'reprioritizeSubIssue';
          input.beforeId = action.beforeId;
        } else method = 'removeSubIssue';
      }
      validateProjectMutation(method, input);
      const type = method[0].toUpperCase() + method.slice(1) + 'Input';
      const result = await this.query(
        `mutation($input:${type}!){${method}(input:$input){clientMutationId}}`,
        { input },
      );
      if (!result[method]) throw new GitHubRequestError('unknown-outcome');
      return await this.read(project, item);
    } finally {
      this.pending.delete(key);
      this.changed();
    }
  }
}
