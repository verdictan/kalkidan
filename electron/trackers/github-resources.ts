import { createHash } from 'node:crypto';
import type { GraphQL } from '../github-projects';
import type { GitHubProject } from '../../src/domain/github';
import type {
  ProjectResourceKind,
  ProjectResourceOperation,
  ProjectResourceSnapshot,
} from '../../src/domain/github-resources';
import { completeConnection, fieldSelection } from './github-fields';
import { validateProjectMutation } from './github-schema';
import { GitHubRequestError } from './request-scheduler';
const selections: Record<ProjectResourceKind, string> = {
  issueFields: ['Date', 'MultiSelect', 'Number', 'SingleSelect', 'Text']
    .map((type) => `... on IssueField${type}{id name dataType description}`)
    .join(' '),
  fields: fieldSelection,
  views:
    'id name number layout filter updatedAt groupByFields(first:100){nodes{... on ProjectV2FieldCommon{id}} pageInfo{hasNextPage endCursor}} verticalGroupByFields(first:100){nodes{... on ProjectV2FieldCommon{id}} pageInfo{hasNextPage endCursor}} sortByFields(first:100){nodes{direction field{... on ProjectV2FieldCommon{id}}} pageInfo{hasNextPage endCursor}} configuration{visibleFields(first:100){nodes{... on ProjectV2FieldCommon{id}} pageInfo{hasNextPage endCursor}}}',
  statusUpdates: 'id body status startDate targetDate createdAt updatedAt creator{login}',
  workflows: 'id name number enabled createdAt updatedAt',
};
const operations: Record<ProjectResourceOperation, { kind: ProjectResourceKind; key: string }> = {
  createConfiguredProjectView: { kind: 'views', key: 'projectId' },
  createProjectV2IssueField: { kind: 'issueFields', key: 'projectId' },
  createProjectV2Field: { kind: 'fields', key: 'projectId' },
  updateProjectV2Field: { kind: 'fields', key: 'fieldId' },
  deleteProjectV2Field: { kind: 'fields', key: 'fieldId' },
  createProjectV2View: { kind: 'views', key: 'projectId' },
  updateProjectV2View: { kind: 'views', key: 'viewId' },
  deleteProjectV2View: { kind: 'views', key: 'viewId' },
  createProjectV2StatusUpdate: { kind: 'statusUpdates', key: 'projectId' },
  updateProjectV2StatusUpdate: { kind: 'statusUpdates', key: 'statusUpdateId' },
  deleteProjectV2StatusUpdate: { kind: 'statusUpdates', key: 'statusUpdateId' },
  deleteProjectV2Workflow: { kind: 'workflows', key: 'workflowId' },
};
/** Resource IDs must belong to the linked project. Never accept a renderer GraphQL document. */
export class GitHubProjectResources {
  private pending = new Set<string>();
  constructor(
    private query: GraphQL,
    private changed: () => void,
    private rest?: (path: string, body?: Record<string, unknown>) => Promise<{ body: unknown }>,
  ) {}
  async read(project: GitHubProject, kind: ProjectResourceKind): Promise<ProjectResourceSnapshot> {
    if (!Object.hasOwn(selections, kind) || !/^[A-Za-z0-9_-]{1,200}$/.test(project.id))
      throw new Error('Invalid project resource.');
    let writable: boolean | undefined;
    const read = async (cursor?: string) => {
      const result = await this.query(
        `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{id viewerCanUpdate ${kind === 'issueFields' ? `owner{... on Organization{issueFields(first:100,after:$cursor){nodes{${selections[kind]}} pageInfo{hasNextPage endCursor}}}}` : `${kind}(first:100,after:$cursor){nodes{${selections[kind]}} pageInfo{hasNextPage endCursor}}`}}}}`,
        { id: project.id, cursor },
      );
      if (result.node?.id !== project.id || typeof result.node.viewerCanUpdate !== 'boolean')
        throw new Error('The project is not accessible.');
      if (writable !== undefined && writable !== result.node.viewerCanUpdate)
        throw new Error('Project access changed during loading.');
      writable = result.node.viewerCanUpdate;
      if (kind === 'issueFields' && !result.node.owner?.issueFields)
        throw new Error('Organization issue fields require an organization-owned project.');
      return kind === 'issueFields' ? result.node.owner.issueFields : result.node[kind];
    };
    const records = await completeConnection(await read(), read, 10000);
    if (records.some((record) => typeof record.id !== 'string'))
      throw new Error('GitHub returned an incomplete resource.');
    if (kind === 'views')
      for (const record of records) {
        const first = record.configuration?.visibleFields;
        const fields = await completeConnection(
          first,
          async (cursor) => {
            const data = await this.query(
              `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2View{project{id} configuration{visibleFields(first:100,after:$cursor){nodes{... on ProjectV2FieldCommon{id}} pageInfo{hasNextPage endCursor}}}}}}`,
              { id: record.id, cursor },
            );
            if (data.node?.project?.id !== project.id)
              throw new Error('The view moved or is not accessible.');
            return data.node.configuration.visibleFields;
          },
          1000,
        );
        record.configuration = { visibleFieldIds: fields.map((field) => field.id) };
        for (const key of ['groupByFields', 'verticalGroupByFields', 'sortByFields']) {
          const selection =
            key === 'sortByFields'
              ? 'direction field{... on ProjectV2FieldCommon{id}}'
              : '... on ProjectV2FieldCommon{id}';
          record[key] = await completeConnection(
            record[key],
            async (cursor) => {
              const data = await this.query(
                `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2View{project{id} ${key}(first:100,after:$cursor){nodes{${selection}} pageInfo{hasNextPage endCursor}}}}}`,
                { id: record.id, cursor },
              );
              if (data.node?.project?.id !== project.id)
                throw new Error('The view is no longer in this project.');
              return data.node[key];
            },
            1000,
          );
        }
      }
    return {
      projectId: project.id,
      kind,
      writable: writable === true,
      records,
      revision: createHash('sha256')
        .update(JSON.stringify([project.id, kind, writable, records]))
        .digest('hex'),
    };
  }
  private async createConfiguredView(project: GitHubProject, input: Record<string, unknown>) {
    if (
      !this.rest ||
      Object.keys(input).some(
        (key) =>
          ![
            'projectId',
            'name',
            'layout',
            'filter',
            'visibleFieldIds',
            'groupFieldId',
            'columnFieldId',
            'sort',
          ].includes(key),
      )
    )
      throw new Error('Invalid saved view configuration.');
    validateProjectMutation('createProjectV2View', {
      projectId: project.id,
      name: input.name,
      layout: input.layout,
    });
    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 256 ||
      !['TABLE_LAYOUT', 'BOARD_LAYOUT', 'ROADMAP_LAYOUT'].includes(String(input.layout)) ||
      typeof input.filter !== 'string' ||
      input.filter.length > 2000
    )
      throw new Error('Enter a view name and a filter up to 2,000 characters.');
    const fields = await this.read(project, 'fields');
    const field = (id: unknown) => {
      const value = fields.records.find((field) => field.id === id);
      if (!value || !Number.isSafeInteger(value.databaseId) || Number(value.databaseId) < 1)
        throw new Error('Choose a field from this project.');
      return value;
    };
    const group = (id: unknown) => {
      const value = field(id);
      if (
        [
          'TITLE',
          'REVIEWERS',
          'LINKED_PULL_REQUESTS',
          'SUB_ISSUES_PROGRESS',
          'TRACKED_BY',
          'TRACKS',
        ].includes(String(value.dataType))
      )
        throw new Error('This field cannot group a view.');
      return value.databaseId;
    };
    const visible = input.visibleFieldIds as unknown[] | undefined;
    if (
      visible &&
      (!Array.isArray(visible) || visible.length > 50 || new Set(visible).size !== visible.length)
    )
      throw new Error('Select up to 50 distinct visible fields.');
    const sort = input.sort as { id: string; direction: string }[] | undefined;
    if (
      sort &&
      (!Array.isArray(sort) ||
        sort.length > 10 ||
        new Set(sort.map((row) => row?.id)).size !== sort.length ||
        sort.some((row) => !row || !['ASC', 'DESC'].includes(row.direction)))
    )
      throw new Error('Invalid view sort configuration.');
    const { node } = await this.query(
      'query($id:ID!){node(id:$id){... on ProjectV2{id number owner{__typename ... on Organization{login} ... on User{login databaseId}}}}}',
      { id: project.id },
    );
    if (
      node?.id !== project.id ||
      node.number !== project.number ||
      node.owner?.login?.toLowerCase() !== project.owner.toLowerCase()
    )
      throw new Error('Project ownership changed.');
    const owner = node.owner;
    if (
      !['Organization', 'User'].includes(owner.__typename) ||
      (owner.__typename === 'User' && !Number.isSafeInteger(owner.databaseId))
    )
      throw new Error('The project owner is not supported.');
    const layout = { TABLE_LAYOUT: 'table', BOARD_LAYOUT: 'board', ROADMAP_LAYOUT: 'roadmap' }[
      String(input.layout) as 'TABLE_LAYOUT'
    ];
    const body = {
      name: input.name.trim(),
      layout,
      filter: input.filter,
      ...(visible?.length && layout !== 'roadmap'
        ? { visible_fields: visible.map((id) => field(id).databaseId) }
        : {}),
      ...(input.groupFieldId ? { group_by: [group(input.groupFieldId)] } : {}),
      ...(input.columnFieldId && layout === 'board'
        ? { vertical_group_by: [group(input.columnFieldId)] }
        : {}),
      ...(sort?.length
        ? { sort_by: sort.map((row) => [field(row.id).databaseId, row.direction.toLowerCase()]) }
        : {}),
    };
    const result = await this.rest(
      `/${owner.__typename === 'Organization' ? 'orgs/' + owner.login : 'users/' + owner.databaseId}/projectsV2/${project.number}/views`,
      body,
    );
    if (
      !result.body ||
      typeof result.body !== 'object' ||
      !Number.isSafeInteger((result.body as any).id)
    )
      throw new GitHubRequestError('unknown-outcome');
    return this.read(project, 'views');
  }
  async change(
    project: GitHubProject,
    revision: string,
    operation: ProjectResourceOperation,
    values: Record<string, unknown>,
  ) {
    if (
      !Object.hasOwn(operations, operation) ||
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      typeof revision !== 'string'
    )
      throw new Error('Invalid project operation.');
    const definition = operations[operation];
    const input = { ...values };
    if (definition.key === 'projectId') {
      if ('projectId' in input && input.projectId !== project.id)
        throw new Error('The project does not match.');
      input.projectId = project.id;
    }
    if (operation !== 'createConfiguredProjectView') validateProjectMutation(operation, input);
    if (this.pending.has(project.id)) throw new Error('A project change is already in progress.');
    this.pending.add(project.id);
    try {
      const current = await this.read(project, definition.kind);
      if (!current.writable) throw new Error('You do not have permission to change this project.');
      if (current.revision !== revision)
        throw new Error('The project changed. Reload before saving.');
      if (operation === 'createConfiguredProjectView')
        return await this.createConfiguredView(project, input);
      if (
        definition.key !== 'projectId' &&
        !current.records.some((record) => record.id === input[definition.key])
      )
        throw new Error('The resource is not in this project.');
      if (
        operation === 'createProjectV2IssueField' &&
        !current.records.some((record) => record.id === input.issueFieldId)
      )
        throw new Error('Choose an issue field from the project organization.');
      if (
        'name' in input &&
        (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 256)
      )
        throw new Error('Enter a name up to 256 characters.');
      if (definition.kind === 'fields') {
        const existing = current.records.find((record) => record.id === input.fieldId) as any;
        for (const key of ['singleSelectOptions', 'multiSelectOptions']) {
          const options = input[key] as { id?: string; name: string }[] | undefined;
          if (!options) continue;
          if (
            !options.length ||
            options.length > 100 ||
            options.some(
              (option) =>
                !option.name.trim() ||
                option.name.length > 256 ||
                (option.id && !existing?.options?.some((old: any) => old.id === option.id)),
            )
          )
            throw new Error('Keep valid option IDs and enter at least one option.');
          const ids = options.flatMap((option) => (option.id ? [option.id] : []));
          if (new Set(ids).size !== ids.length) throw new Error('An option ID is repeated.');
        }
        const iteration = input.iterationConfiguration as any;
        if (iteration) {
          const old = [
            ...(existing?.configuration?.iterations || []),
            ...(existing?.configuration?.completedIterations || []),
          ];
          if (
            !iteration.iterations?.length ||
            !Number.isInteger(iteration.duration) ||
            iteration.duration < 1 ||
            iteration.iterations.some(
              (value: any) =>
                !value.title?.trim() ||
                !Number.isInteger(value.duration) ||
                value.duration < 1 ||
                (value.id && !old.some((row) => row.id === value.id)),
            )
          )
            throw new Error('Enter valid iterations with positive durations.');
        }
      }
      const config = input.configuration as { visibleFieldIds?: string[] } | undefined;
      if (config?.visibleFieldIds) {
        const fields = await this.read(project, 'fields');
        if (
          new Set(config.visibleFieldIds).size !== config.visibleFieldIds.length ||
          config.visibleFieldIds.some((id) => !fields.records.some((field) => field.id === id))
        )
          throw new Error('Choose fields from this project.');
      }
      const inputType = operation[0].toUpperCase() + operation.slice(1) + 'Input';
      const data = await this.query(
        `mutation($input:${inputType}!){${operation}(input:$input){clientMutationId}}`,
        { input },
      );
      if (!data?.[operation]) throw new GitHubRequestError('unknown-outcome');
      return await this.read(project, definition.kind);
    } finally {
      this.pending.delete(project.id);
      this.changed();
    }
  }
}
