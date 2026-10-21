import type { GraphQL } from '../github-projects';
import type { TrackerField } from '../../src/domain/tracker';

export const fieldSelection = `__typename ... on ProjectV2FieldCommon{id name dataType databaseId}
  ... on ProjectV2SingleSelectField{options{id name color description}}
  ... on ProjectV2MultiSelectField{options:multiSelectOptions{id name color description}}
  ... on ProjectV2IterationField{configuration{duration startDay iterations{id title startDate duration}
    completedIterations{id title startDate duration}}}`;
const valueConnections: Record<string, { key: string; selection: string }> = {
  ProjectV2ItemFieldLabelValue: { key: 'labels', selection: 'id name' },
  ProjectV2ItemFieldUserValue: { key: 'users', selection: 'id login' },
  ProjectV2ItemFieldPullRequestValue: {
    key: 'pullRequests',
    selection: 'id title url state merged',
  },
  ProjectV2ItemFieldReviewerValue: {
    key: 'reviewers',
    selection: '__typename ... on User{id login} ... on Team{id name slug}',
  },
};
const valueField = 'field{... on ProjectV2FieldCommon{id name}}';
/**
 * The first page of each connection inside a field value. GitHub rejects a query that can
 * return more than 500,000 nodes (MAX_NODE_LIMIT_EXCEEDED). The board reads items × field
 * values × these connections in one query, so this page stays small. `completeFieldValues`
 * reads the other pages.
 */
export const valueConnectionPage = 20;
export const valueSelection = `__typename
  ${Object.entries(valueConnections)
    .map(
      ([type, { key, selection }]) =>
        `... on ${type}{${valueField} ${key}(first:${valueConnectionPage}){nodes{${selection}} pageInfo{hasNextPage endCursor}}}`,
    )
    .join('\n')}
  ... on ProjectV2ItemFieldMilestoneValue{${valueField} milestone{id title url}}
  ... on ProjectV2ItemFieldRepositoryValue{${valueField} repository{id nameWithOwner url}}
  ... on ProjectV2ItemFieldMultiSelectValue{options{id name color description} field{... on ProjectV2MultiSelectField{id name}}}
  ... on ProjectV2ItemFieldSingleSelectValue{optionId name field{... on ProjectV2SingleSelectField{id name}}}
  ... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2Field{id name}}}
  ... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2Field{id name}}}
  ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2Field{id name}}}
  ... on ProjectV2ItemFieldIterationValue{iterationId title field{... on ProjectV2IterationField{id name}}}`;

/** Built-in values contain their own connections. Do not publish their first page as complete. */
export async function completeFieldValues(
  query: GraphQL,
  projectId: string,
  itemId: string,
  values: any[],
) {
  for (const value of values) {
    const connection = valueConnections[value.__typename];
    if (!connection) continue;
    const { key, selection } = connection;
    value[key] = await completeConnection(value[key], async (cursor) => {
      const read = async (valuesCursor?: string) => {
        const data = await query(
          `query($id:ID!,$cursor:String,$valuesCursor:String){node(id:$id){... on ProjectV2Item{project{id} fieldValues(first:100,after:$valuesCursor){nodes{... on ${value.__typename}{${valueField} ${key}(first:100,after:$cursor){nodes{${selection}} pageInfo{hasNextPage endCursor}}}} pageInfo{hasNextPage endCursor}}}}}`,
          { id: itemId, cursor, valuesCursor },
        );
        if (data.node?.project?.id !== projectId)
          throw new Error('The item moved to another project.');
        return data.node.fieldValues;
      };
      const candidates = await completeConnection(await read(), read, 1000);
      const current = candidates.find((candidate) => candidate.field?.id === value.field?.id);
      if (!current) throw new Error('The content field changed during loading.');
      return current[key];
    });
  }
  return values;
}

/** Read every page before publishing a snapshot. Repeated cursors are a protocol error. */
export async function completeConnection(
  first: any,
  next: (cursor: string) => Promise<any>,
  limit = 10000,
): Promise<any[]> {
  const rows: any[] = [];
  const cursors = new Set<string>();
  let page = first;
  while (true) {
    if (!page || !Array.isArray(page.nodes))
      throw new Error('GitHub returned an incomplete connection. Refresh the project.');
    rows.push(...page.nodes.filter((node: unknown) => node !== null));
    if (rows.length > limit)
      throw new Error('GitHub returned too many records. Open this project in GitHub.');
    if (!page.pageInfo?.hasNextPage) return rows;
    const cursor = page.pageInfo.endCursor;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor))
      throw new Error('GitHub returned an invalid pagination cursor. Refresh the project.');
    cursors.add(cursor);
    page = await next(cursor);
  }
}
export async function readFields(
  query: GraphQL,
  project: string,
  first: any,
): Promise<TrackerField[]> {
  const rows = await completeConnection(
    first,
    async (cursor) => {
      const data = await query(
        `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{
      fields(first:100,after:$cursor){nodes{${fieldSelection}} pageInfo{hasNextPage endCursor}}
    }}}`,
        { id: project, cursor },
      );
      return data.node?.fields;
    },
    1000,
  );
  return rows.map((field) => ({
    id: typeof field.id === 'string' ? field.id : '',
    name: typeof field.name === 'string' ? field.name : 'Unsupported field',
    dataType:
      typeof field.dataType === 'string'
        ? field.dataType
        : Array.isArray(field.options)
          ? 'SINGLE_SELECT'
          : 'UNKNOWN',
    options: Array.isArray(field.options)
      ? field.options.map((option: any) => ({
          id: option.id,
          name: option.name,
        }))
      : undefined,
    iterations: field.configuration
      ? [
          ...(field.configuration.iterations || []),
          ...(field.configuration.completedIterations || []),
        ]
      : undefined,
    raw: structuredClone(field),
  }));
}
export function workflowField(fields: TrackerField[], fieldId?: string) {
  const choices = fields.filter((field) => field.dataType === 'SINGLE_SELECT' && field.options);
  // A label is not an identifier. Multiple fields require an explicit saved selection.
  const selected = fieldId
    ? choices.find((field) => field.id === fieldId)
    : choices.length === 1
      ? choices[0]
      : undefined;
  return selected ? { id: selected.id, options: selected.options! } : undefined;
}
