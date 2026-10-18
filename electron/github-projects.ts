import { access } from 'node:fs/promises';
import { exec } from './core';
import type { GitHubProject, GitHubBoard, GitHubItem, GitHubOwner } from '../src/types';
export type GraphQL = (query: string, variables: Record<string, unknown>) => Promise<any>;
export async function githubExecutable() {
  for (const candidate of ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']) {
    try { await access(candidate); return candidate; } catch {}
  }
  return 'gh';
}
export const githubGraphQL: GraphQL = async (query, variables) => {
  const executable = await githubExecutable();
  const args = ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) if (value !== undefined && value !== null) args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  try {
    const { stdout } = await exec(executable, args, { timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (result.errors?.length) throw new Error(result.errors.map((e: any) => e.message).join('\n'));
    return result.data;
  } catch (error: any) {
    // Do not echo exec arguments, which may contain private item text.
    const detail = String(error.stderr || '').split('\n').filter((line: string) => !line.startsWith('Command failed:')).join('\n');
    throw new Error(`GitHub Projects could not complete this request. Sign in with gh auth login and grant project access using gh auth refresh -h github.com -s project. ${detail.slice(-800)}`);
  }
};
export function parseProjectURL(value: string) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(users|orgs)\/([\w-]+)\/projects\/(\d+)\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || !match) throw new Error('Use a GitHub Projects URL such as https://github.com/orgs/company/projects/1');
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid project number');
  return { owner: match[2], number, kind: match[1] === 'orgs' ? 'organization' : 'user' };
}
export class GitHubProjects {
  constructor(private query: GraphQL = githubGraphQL) {}
  async owners(): Promise<GitHubOwner[]> {
    const owners: GitHubOwner[] = []; let cursor: string | undefined;
    do {
      const { viewer } = await this.query('query($cursor:String){viewer{id login organizations(first:100,after:$cursor){nodes{id login} pageInfo{hasNextPage endCursor}}}}', { cursor });
      if (!owners.length) owners.push({ id: viewer.id, login: viewer.login, kind: 'user' });
      owners.push(...viewer.organizations.nodes.map((o: any) => ({ ...o, kind: 'organization' })));
      cursor = nextCursor(viewer.organizations.pageInfo, cursor);
    } while (cursor);
    return owners;
  }
  async list(owner: GitHubOwner): Promise<GitHubProject[]> {
    validateOwner(owner);
    const projects: GitHubProject[] = []; let cursor: string | undefined;
    do {
      const data = await this.query(`query($owner:String!,$cursor:String){${owner.kind}(login:$owner){projectsV2(first:100,after:$cursor){nodes{id title url number closed} pageInfo{hasNextPage endCursor}}}}`, { owner: owner.login, cursor });
      const connection = data[owner.kind]?.projectsV2;
      if (!connection) throw new Error('This owner is not accessible to your GitHub account.');
      projects.push(...connection.nodes.filter((p: any) => !p.closed).map((p: any) => ({ id: p.id, title: p.title, url: p.url, number: p.number, owner: owner.login })));
      cursor = nextCursor(connection.pageInfo, cursor);
    } while (cursor);
    return projects;
  }
  async create(owner: GitHubOwner, title: string): Promise<GitHubProject> {
    validateOwner(owner);
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 256) throw new Error('Enter a project title of up to 256 characters.');
    // Resolve the owner again; do not trust a renderer-supplied node ID.
    const data = await this.query(`query($owner:String!){${owner.kind}(login:$owner){id}}`, { owner: owner.login });
    if (!data[owner.kind]?.id) throw new Error('GitHub owner not found.');
    const result = await this.query('mutation($owner:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,title:$title}){projectV2{id title url number}}}', { owner: data[owner.kind].id, title: title.trim() });
    if (!result.createProjectV2?.projectV2) throw new Error('GitHub did not return the created project. Refresh the list before retrying.');
    return { ...result.createProjectV2.projectV2, owner: owner.login };
  }
  async resolve(url: string): Promise<GitHubProject> {
    const { owner, number, kind } = parseProjectURL(url);
    const data = await this.query(`query($owner:String!,$number:Int!){${kind}(login:$owner){projectV2(number:$number){id title url number closed}}}`, { owner, number });
    const project = data[kind]?.projectV2;
    if (!project) throw new Error('Project not found or not accessible to your GitHub account.');
    if (project.closed) throw new Error('This GitHub project is closed.');
    return { id: project.id, title: project.title, url: project.url, number: project.number, owner };
  }
  async board(project: GitHubProject): Promise<GitHubBoard> {
    const items: GitHubItem[] = []; let cursor: string | undefined; let statusField: GitHubBoard['statusField'];
    do {
      const data = await this.query(`query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{title fields(first:100){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}} items(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isArchived content{... on Issue{title body url number repository{nameWithOwner}} ... on PullRequest{title body url number repository{nameWithOwner}} ... on DraftIssue{title body}} fieldValues(first:100){nodes{... on ProjectV2ItemFieldSingleSelectValue{optionId name field{... on ProjectV2SingleSelectField{id name}}}}}}}}}}`, { id: project.id, cursor });
      const node = data.node; if (!node?.items) throw new Error('Linked GitHub project is no longer accessible.');
      const status = node.fields.nodes.find((field: any) => field.name === 'Status' && field.options);
      statusField = status ? { id: status.id, options: status.options } : undefined;
      for (const row of node.items.nodes) {
        if (row.isArchived || !row.content) continue;
        const value = row.fieldValues.nodes.find((v: any) => v.field?.id === status?.id);
        items.push({ id: row.id, title: row.content.title, body: row.content.body || '', url: row.content.url, repository: row.content.repository?.nameWithOwner, number: row.content.number, status: value?.name, statusId: value?.optionId });
      }
      const info = node.items.pageInfo;
      if (info.hasNextPage && (!info.endCursor || info.endCursor === cursor)) throw new Error('GitHub returned an invalid pagination cursor. Refresh the project.');
      cursor = info.hasNextPage ? info.endCursor : undefined;
    } while (cursor);
    return { project, items, statusField };
  }
  async setStatus(project: GitHubProject, itemId: string, optionId: string) {
    const board = await this.board(project);
    if (!board.items.some(item => item.id === itemId) || !board.statusField?.options.some(option => option.id === optionId)) throw new Error('Item or status no longer exists. Refresh the project.');
    await this.query('mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}', { project: project.id, item: itemId, field: board.statusField.id, option: optionId });
  }
  async addDraft(project: GitHubProject, title: string, body: string) {
    if (typeof title !== 'string' || !title.trim() || title.length > 256 || typeof body !== 'string' || body.length > 20000) throw new Error('Enter a title up to 256 characters and a description up to 20,000 characters.');
    await this.query('mutation($project:ID!,$title:String!,$body:String!){addProjectV2DraftIssue(input:{projectId:$project,title:$title,body:$body}){projectItem{id}}}', { project: project.id, title: title.trim(), body });
  }
  async addIssue(project: GitHubProject, value: string) {
    const url = new URL(value); const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)\/?$/);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match) throw new Error('Enter a github.com issue or pull request URL.');
    const data = await this.query('query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issueOrPullRequest(number:$number){... on Issue{id} ... on PullRequest{id}}}}', { owner: match[1], repo: match[2], number: Number(match[4]) });
    const id = data.repository?.issueOrPullRequest?.id; if (!id) throw new Error('Issue or pull request not found.');
    await this.query('mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}', { project: project.id, content: id });
  }
}

function validateOwner(owner: GitHubOwner) {
  if (!owner || !['user', 'organization'].includes(owner.kind) || typeof owner.login !== 'string' || !/^[\w-]{1,100}$/.test(owner.login)) throw new Error('Choose a valid GitHub owner.');
}
function nextCursor(info: { hasNextPage: boolean; endCursor?: string }, previous?: string) {
  if (info.hasNextPage && (!info.endCursor || info.endCursor === previous)) throw new Error('GitHub returned an invalid pagination cursor. Try again.');
  return info.hasNextPage ? info.endCursor : undefined;
}
