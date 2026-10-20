import { GitHubRequestError } from './request-scheduler';
import type { GraphQL } from '../github-projects';
import type { GitHubProject } from '../../src/domain/github';
import type { ProjectFieldValue, ProjectItemAction } from '../../src/domain/github-mutations';
import { fieldSelection, readFields } from './github-fields';
import { validateProjectMutation } from './github-schema';

const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** Server permissions and membership are read again for every write. No mutation is replayed. */
export class GitHubProjectMutations {
  private pending = new Set<string>();
  constructor(
    private query: GraphQL,
    private changed: () => void,
  ) {}
  private async mutate(query: string, variables: Record<string, unknown>) {
    const field = /\{([a-zA-Z0-9]+)\(input:/.exec(query)?.[1];
    validateProjectMutation(field || '', variables.input);
    const result = await this.query(query, variables);
    if (!field || !result?.[field]) throw new GitHubRequestError('unknown-outcome');
  }
  private async run(
    project: GitHubProject,
    itemId: string,
    action: (item: any, project: any) => Promise<void>,
  ) {
    if (!id(project.id) || !id(itemId)) throw new Error('Invalid project or item ID.');
    const key = `${project.id}:${itemId}`;
    if (this.pending.has(key)) throw new Error('This item already has a change in progress.');
    this.pending.add(key);
    try {
      const data = await this.query(
        `query($project:ID!,$item:ID!){
        project:node(id:$project){... on ProjectV2{id viewerCanUpdate fields(first:100){nodes{${fieldSelection}} pageInfo{hasNextPage endCursor}}}}
        item:node(id:$item){... on ProjectV2Item{id isArchived project{id} content{__typename ... on DraftIssue{id}}}}}`,
        { project: project.id, item: itemId },
      );
      if (data.project?.viewerCanUpdate !== true)
        throw new Error('You do not have permission to change this GitHub project.');
      if (data.item?.project?.id !== project.id)
        throw new Error('This item is no longer in this GitHub project.');
      await action(data.item, data.project);
    } finally {
      this.pending.delete(key);
      this.changed();
    }
  }
  async field(project: GitHubProject, itemId: string, fieldId: string, value: ProjectFieldValue) {
    if (!id(fieldId)) throw new Error('Invalid field ID.');
    await this.run(project, itemId, async (_item, node) => {
      const fields = await readFields(this.query, project.id, node.fields);
      const field = fields.find((entry) => entry.id === fieldId);
      if (!field) throw new Error('The field was removed. Refresh this project.');
      const key = (
        {
          TEXT: 'text',
          NUMBER: 'number',
          DATE: 'date',
          SINGLE_SELECT: 'singleSelectOptionId',
          MULTI_SELECT: 'multiSelectOptionIds',
          ITERATION: 'iterationId',
        } as Record<string, string>
      )[field.dataType];
      if (!key) throw new Error('Edit this field on GitHub. Its type is not writable here.');
      if (value === null) {
        await this.mutate(
          'mutation($input:ClearProjectV2ItemFieldValueInput!){clearProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}',
          { input: { projectId: project.id, itemId, fieldId } },
        );
        return;
      }
      if (!object(value) || Object.keys(value).length !== 1 || !(key in value))
        throw new Error('Invalid field value.');
      const raw = (value as Record<string, unknown>)[key];
      if (key === 'text' && (typeof raw !== 'string' || raw.length > 20000))
        throw new Error('Text must contain at most 20,000 characters.');
      if (key === 'number' && (typeof raw !== 'number' || !Number.isFinite(raw)))
        throw new Error('Enter a finite number.');
      if (
        key === 'date' &&
        (typeof raw !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
          !Number.isFinite(Date.parse(raw)) ||
          new Date(raw).toISOString().slice(0, 10) !== raw)
      )
        throw new Error('Enter a valid date.');
      if (key === 'singleSelectOptionId' && !field.options?.some((option) => option.id === raw))
        throw new Error('Select an option from this field.');
      if (
        key === 'multiSelectOptionIds' &&
        (!Array.isArray(raw) ||
          raw.length > 100 ||
          new Set(raw).size !== raw.length ||
          !raw.every((value) => field.options?.some((option) => option.id === value)))
      )
        throw new Error('Select valid options from this field.');
      if (key === 'iterationId' && !field.iterations?.some((iteration) => iteration.id === raw))
        throw new Error('Select an iteration from this field.');
      await this.mutate(
        'mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}',
        { input: { projectId: project.id, itemId, fieldId, value } },
      );
    });
  }
  async item(project: GitHubProject, itemId: string, action: ProjectItemAction) {
    if (
      !object(action) ||
      !['archive', 'unarchive', 'remove', 'edit-draft', 'convert', 'reorder'].includes(action.kind)
    )
      throw new Error('Invalid item action.');
    await this.run(project, itemId, async (item) => {
      if (action.kind === 'archive' || action.kind === 'unarchive' || action.kind === 'remove') {
        if (
          (action.kind === 'archive' && item.isArchived) ||
          (action.kind === 'unarchive' && !item.isArchived)
        )
          return;
        const method = {
          archive: 'archiveProjectV2Item',
          unarchive: 'unarchiveProjectV2Item',
          remove: 'deleteProjectV2Item',
        }[action.kind];
        const inputType = method[0].toUpperCase() + method.slice(1) + 'Input';
        await this.mutate(
          `mutation($input:${inputType}!){${method}(input:$input){clientMutationId}}`,
          { input: { projectId: project.id, itemId } },
        );
      } else if (action.kind === 'reorder') {
        if (action.afterId !== null) {
          if (!id(action.afterId) || action.afterId === itemId)
            throw new Error('Choose another item for the position.');
          const after = await this.query(
            'query($id:ID!){node(id:$id){... on ProjectV2Item{project{id}}}}',
            { id: action.afterId },
          );
          if (after.node?.project?.id !== project.id)
            throw new Error('The position item is not in this project.');
        }
        await this.mutate(
          'mutation($input:UpdateProjectV2ItemPositionInput!){updateProjectV2ItemPosition(input:$input){clientMutationId}}',
          { input: { projectId: project.id, itemId, afterId: action.afterId } },
        );
      } else {
        if (item.content?.__typename !== 'DraftIssue' || !id(item.content.id))
          throw new Error('This item is no longer a draft. Refresh this project.');
        if (action.kind === 'edit-draft') {
          if (
            typeof action.title !== 'string' ||
            !action.title.trim() ||
            action.title.length > 256 ||
            typeof action.body !== 'string' ||
            action.body.length > 20000
          )
            throw new Error(
              'Enter a title up to 256 characters and a description up to 20,000 characters.',
            );
          await this.mutate(
            'mutation($input:UpdateProjectV2DraftIssueInput!){updateProjectV2DraftIssue(input:$input){clientMutationId}}',
            {
              input: {
                draftIssueId: item.content.id,
                title: action.title.trim(),
                body: action.body,
              },
            },
          );
        } else {
          if (
            typeof action.repository !== 'string' ||
            !/^[\w.-]+\/[\w.-]+$/.test(action.repository)
          )
            throw new Error('Enter a repository as owner/name.');
          const [owner, name] = action.repository.split('/');
          const repository = await this.query(
            'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id hasIssuesEnabled viewerPermission}}',
            { owner, name },
          );
          if (
            !repository.repository?.hasIssuesEnabled ||
            !['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE'].includes(
              repository.repository.viewerPermission,
            )
          )
            throw new Error('Choose a repository with issue access.');
          await this.mutate(
            'mutation($input:ConvertProjectV2DraftIssueItemToIssueInput!){convertProjectV2DraftIssueItemToIssue(input:$input){item{id}}}',
            { input: { itemId, repositoryId: repository.repository.id } },
          );
        }
      }
    });
  }
}
