import { GitHubDocsPlan } from './trackers/github-docs-plan';
import type { DocsIssuePlan } from '../src/domain/docs-plan';
import { GitHubProjectBatch } from './trackers/github-batch';
import { GitHubMutationJournal, journalDetail } from './trackers/github-journal';
import {
  canRevertMutation,
  projectFieldValue,
  type ProjectBatchRequest,
} from '../src/domain/project-batch';
import type { ProjectFieldValue } from '../src/domain/github-mutations';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { GitHubSavedViews } from './trackers/github-views';
import { GitHubProjectContent } from './trackers/github-content';
import { GitHubIssueRelations } from './trackers/github-relations';
import { GitHubProjectResources } from './trackers/github-resources';
import { createHash, randomUUID } from 'node:crypto';
import { GitHubProjectSettings } from './trackers/github-settings';
import { GitHubProjectMutations } from './trackers/github-mutations';
import { ResourceCache } from './resource-cache';
import {
  completeConnection,
  completeFieldValues,
  fieldSelection,
  valueSelection,
  readFields,
  workflowField,
} from './trackers/github-fields';
import {
  GitHubRequestError,
  GitHubRequestScheduler,
  githubResponse,
} from './trackers/request-scheduler';
import { access, mkdir } from 'node:fs/promises';
import { withDirectoryLock } from './storage/directory-lock';
import { exec } from './core';
import type { GitHubProject, GitHubBoard, GitHubItem, GitHubOwner } from '../src/types';
export type GraphQL = (query: string, variables: Record<string, unknown>) => Promise<any>;
export async function githubExecutable() {
  for (const candidate of ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return 'gh';
}
const requestScheduler = new GitHubRequestScheduler();
/**
 * Board page sizes. GitHub limits a query to 500,000 possible nodes. Items × field values ×
 * the value connections must stay below it. Other pages load with their own requests.
 */
export const boardItemPage = 50;
export const boardValuePage = 50;
const githubAccount = new AsyncLocalStorage<string>();
const githubWriteGuard = new AsyncLocalStorage<() => void>();
const githubJournal = new AsyncLocalStorage<GitHubMutationJournal>();
async function githubToken() {
  const current = githubAccount.getStore();
  if (current) return current;
  try {
    const { stdout } = await exec(
      await githubExecutable(),
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 15000, maxBuffer: 100000 },
    );
    if (!stdout.trim()) throw new Error('Missing credential');
    return stdout.trim();
  } catch {
    throw new GitHubRequestError('signed-out');
  }
}
export const githubGraphQL: GraphQL = (query, variables) => {
  const account = githubAccount.getStore();
  const guard = githubWriteGuard.getStore();
  const mutation = /^\s*mutation\b/.test(query);
  const send = () =>
    requestScheduler.run(async () => {
      const executable = await githubExecutable();
      const args = ['api', '--hostname', 'github.com', 'graphql', '--include', '--input', '-'];
      if (mutation) guard?.();
      try {
        const command = exec(executable, args, {
          timeout: 30000,
          ...(account ? { env: { ...process.env, GH_TOKEN: account, GH_HOST: 'github.com' } } : {}),
          maxBuffer: 20 * 1024 * 1024,
        });
        command.child.stdin?.on('error', () => {});
        command.child.stdin?.end(JSON.stringify({ query, variables }));
        const { stdout } = await command;
        return githubResponse(stdout, mutation, requestScheduler);
      } catch (error: any) {
        if (error instanceof GitHubRequestError) throw error;
        if (typeof error.stdout === 'string' && error.stdout.startsWith('HTTP/'))
          return githubResponse(error.stdout, mutation, requestScheduler);
        // Neither process arguments nor GitHub diagnostics may echo private item content.
        throw new GitHubRequestError(mutation ? 'unknown-outcome' : 'unavailable');
      }
    });
  const journal = githubJournal.getStore();
  return mutation && journal
    ? journal.run(
        /\{\s*(\w+)\s*\(/.exec(query)?.[1] || 'GraphQL mutation',
        { query, variables },
        send,
      )
    : send();
};
/** Fixed GitHub API origin; callers must scope paths to the linked project. */
export async function githubREST(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ body: unknown; link?: string }> {
  if (
    !(
      body
        ? /^\/(orgs|users)\/[\w-]+\/projectsV2\/[1-9]\d*\/views$/
        : /^\/(orgs|users)\/[\w-]+\/projectsV2\/[1-9]\d*\/items(?:\?|$)/
    ).test(path) ||
    path.includes('#')
  )
    throw new Error('Invalid project endpoint.');
  const token = await githubToken();
  const guard = githubWriteGuard.getStore();
  const send = () =>
    requestScheduler.run(async () => {
      if (body) guard?.();
      try {
        const command = exec(
          await githubExecutable(),
          [
            'api',
            '--hostname',
            'github.com',
            '--include',
            '--method',
            body ? 'POST' : 'GET',
            '-H',
            'Accept: application/vnd.github+json',
            '-H',
            'X-GitHub-Api-Version: 2026-03-10',
            ...(body ? ['--input', '-'] : []),
            path,
          ],
          {
            timeout: 30000,
            maxBuffer: 20 * 1024 * 1024,
            env: { ...process.env, GH_TOKEN: token, GH_HOST: 'github.com' },
          },
        );
        if (body) {
          command.child.stdin?.on('error', () => {});
          command.child.stdin?.end(JSON.stringify(body));
        }
        const { stdout } = await command;
        return githubResponse(stdout, !!body, requestScheduler, Date.now(), true);
      } catch (error: any) {
        if (error instanceof GitHubRequestError) throw error;
        if (typeof error.stdout === 'string' && error.stdout.startsWith('HTTP/'))
          return githubResponse(error.stdout, !!body, requestScheduler, Date.now(), true);
        throw new GitHubRequestError(body ? 'unknown-outcome' : 'unavailable');
      }
    });
  const journal = githubJournal.getStore();
  return body && journal ? journal.run('Create configured view', { path, body }, send) : send();
}
export function parseProjectURL(value: string) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(users|orgs)\/([\w-]+)\/projects\/(\d+)\/?$/);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error('Use a GitHub Projects URL such as https://github.com/orgs/company/projects/1');
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid project number');
  return { owner: match[2], number, kind: match[1] === 'orgs' ? 'organization' : 'user' };
}
export class GitHubProjects {
  private boards = new ResourceCache<GitHubBoard>();
  private account = '';
  private generation = 0;
  private identityPending?: Promise<{ identity: string; generation: number }>;
  constructor(
    private query: GraphQL = githubGraphQL,
    private identity = async () => {
      if (query !== githubGraphQL) return 'injected-transport';
      return createHash('sha256')
        .update(await githubToken())
        .digest('hex');
    },
    private writeRoot?: string,
  ) {
    this.mutations = new GitHubProjectMutations(query, () => this.invalidateBoards());
    this.resources = new GitHubProjectResources(query, () => this.invalidateBoards(), githubREST);
    this.views = new GitHubSavedViews(this.resources, githubREST);
    this.content = new GitHubProjectContent(query, () => this.invalidateBoards());
    this.relations = new GitHubIssueRelations(query, () => this.invalidateBoards());
    this.settings = new GitHubProjectSettings(query, () => this.invalidateBoards());
  }
  async portfolio(projects: GitHubProject[]) {
    if (!Array.isArray(projects) || projects.length > 20)
      throw new Error('Select up to 20 projects.');
    return this.withAccount(async () => {
      const results: { board?: GitHubBoard; error?: string }[] = Array(projects.length),
        queue = projects.map((project, index) => ({ project, index }));
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length) {
            const { project, index } = queue.shift()!;
            try {
              results[index] = { board: await this.board(project, true) };
            } catch (error) {
              results[index] = {
                error: error instanceof Error ? error.message : 'Project access failed.',
              };
            }
          }
        }),
      );
      return results;
    });
  }
  async docsPlan(project: GitHubProject, plan: DocsIssuePlan) {
    if (!this.writeRoot) throw new Error('Issue plan persistence is not configured.');
    return this.withWrite(project, () =>
      new GitHubDocsPlan(join(this.writeRoot!, 'docs-plans')).run(project.id, plan, {
        prepare: async () => {
          const [owner, name] = plan.repository.split('/');
          const { repository } = await this.query(
            'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){hasIssuesEnabled viewerPermission}}',
            { owner, name },
          );
          if (
            !repository?.hasIssuesEnabled ||
            !['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE'].includes(repository.viewerPermission)
          )
            throw new Error('Choose a repository with issue access before publishing this plan.');
        },
        board: () => this.board(project, true),
        create: (title, body) => this.addDraft(project, title, body),
        convert: (item, repository) =>
          this.mutations.item(project, item, { kind: 'convert', repository }),
        relations: (item) => this.relations.read(project, item),
        relate: (item, revision, action) => this.relations.change(project, item, revision, action),
      }),
    );
  }
  async batch(project: GitHubProject, request: ProjectBatchRequest) {
    if (!this.writeRoot) throw new Error('Batch persistence is not configured.');
    return this.withWrite(project, () =>
      new GitHubProjectBatch(join(this.writeRoot!, 'batches')).run(
        project.id,
        request,
        (change) => this.batchItem(project, change.itemId),
        (change) => this.mutations.field(project, change.itemId, change.fieldId, change.value),
      ),
    );
  }
  private async batchItem(project: GitHubProject, itemId: string): Promise<GitHubBoard> {
    const read = async (cursor?: string) => {
      const data = await this.query(
        `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2Item{id isArchived project{id viewerCanUpdate fields(first:100){nodes{${fieldSelection}} pageInfo{hasNextPage endCursor}}} fieldValues(first:100,after:$cursor){nodes{${valueSelection}} pageInfo{hasNextPage endCursor}}}}}`,
        { id: itemId, cursor },
      );
      if (data.node?.id !== itemId || data.node.project?.id !== project.id)
        throw new Error('This task is no longer in the linked project.');
      return data.node;
    };
    const item = await read();
    const values = await completeConnection(
      item.fieldValues,
      async (cursor) => (await read(cursor)).fieldValues,
      1000,
    );
    const fields = await readFields(this.query, project.id, item.project.fields);
    return {
      project,
      writable: item.project.viewerCanUpdate === true,
      fields,
      items: item.isArchived ? [] : [{ id: itemId, title: '', body: '', fieldValues: values }],
    };
  }
  async withWrite<T>(project: GitHubProject, action: () => Promise<T>): Promise<T> {
    if (!this.writeRoot) return this.withAccount(action);
    await mkdir(this.writeRoot, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.writeRoot,
      async (assertOwned) => {
        assertOwned();
        const journal = new GitHubMutationJournal(this.writeRoot!, project.id, assertOwned);
        const result = await githubJournal.run(journal, () =>
          githubWriteGuard.run(assertOwned, () => this.withAccount(action)),
        );
        assertOwned();
        return result;
      },
      createHash('sha256').update(`github.com:${project.id}`).digest('hex'),
    );
  }
  /** Writes one field. History keeps the earlier value, so the write can be reverted. */
  async writeField(
    project: GitHubProject,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ) {
    return this.withWrite(project, async () => {
      let before: ProjectFieldValue | undefined;
      try {
        const item = (await this.batchItem(project, itemId)).items[0];
        if (item) before = projectFieldValue(item, fieldId);
      } catch {
        // The write reads access again and reports the error. Without the value, no revert.
      }
      return journalDetail.run(before === undefined ? {} : { before }, () =>
        this.mutations.field(project, itemId, fieldId, value),
      );
    });
  }
  /**
   * Writes the value from before a confirmed field write as a new batch. Rejects when the write
   * cannot be reverted or when the field changed after the write. Returns the new write's ID.
   */
  async revertMutation(project: GitHubProject, mutationId: string) {
    if (typeof mutationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(mutationId))
      throw new Error('Invalid operation ID.');
    const row = await this.withWrite(project, () => githubJournal.getStore()!.find(mutationId));
    if (!row) throw new Error('This write is no longer in the history.');
    if (row.revertedBy) throw new Error('This change is already reverted.');
    if (!canRevertMutation(row))
      throw new Error('Only confirmed field changes with a known earlier value can be reverted.');
    const { itemId, fieldId, before, value } = row.detail!;
    const result = await journalDetail.run({ revertOf: mutationId, before: value }, () =>
      this.batch(project, {
        id: randomUUID(),
        changes: [{ itemId: itemId!, fieldId: fieldId!, before: value!, value: before! }],
      }),
    );
    const outcome = result.rows[0];
    if (outcome?.state !== 'confirmed')
      throw new Error(
        outcome?.state === 'conflict'
          ? 'The field changed after this write. Change it on GitHub.'
          : outcome?.message || 'GitHub did not confirm the revert. Check the field on GitHub.',
      );
    return this.withWrite(project, async () => {
      const journal = githubJournal.getStore()!;
      const latest = (await journal.list())
        .reverse()
        .find((entry) => entry.detail?.revertOf === mutationId);
      const id = latest?.id || result.id;
      await journal.markReverted(mutationId, id);
      return id;
    });
  }
  async mutationHistory(project: GitHubProject, reviewedId?: string) {
    if (!this.writeRoot) throw new Error('Mutation history is not configured.');
    return this.withWrite(project, async () => {
      const journal = githubJournal.getStore()!;
      if (reviewedId !== undefined) {
        if (typeof reviewedId !== 'string' || !/^[a-f0-9-]{36}$/i.test(reviewedId))
          throw new Error('Invalid operation ID.');
        await journal.review(reviewedId);
      }
      return journal.list();
    });
  }
  withAccount<T>(action: () => Promise<T>): Promise<T> {
    if (this.query !== githubGraphQL || githubAccount.getStore()) return action();
    return githubToken().then((token) => githubAccount.run(token, action));
  }
  readonly mutations: GitHubProjectMutations;
  readonly resources: GitHubProjectResources;
  readonly views: GitHubSavedViews;
  readonly content: GitHubProjectContent;
  readonly relations: GitHubIssueRelations;
  readonly settings: GitHubProjectSettings;
  invalidateBoards() {
    this.generation++;
    this.boards.invalidate();
  }
  get cacheMetrics() {
    return { ...this.boards.metrics };
  }
  private async readIdentity(generation = this.generation) {
    const identity = await this.identity();
    if (generation !== this.generation)
      throw new Error('GitHub access changed during verification. Refresh this project.');
    if (identity !== this.account) {
      this.account = identity;
      this.invalidateBoards();
    }
    return { identity, generation: this.generation };
  }
  private async boardKey(project: GitHubProject) {
    const pending = (this.identityPending ??= this.readIdentity());
    try {
      const { identity, generation } = await pending;
      return {
        key: JSON.stringify(['github.com', identity, project.id, project.statusFieldId]),
        generation,
      };
    } catch (error) {
      this.invalidateBoards();
      throw error;
    } finally {
      if (this.identityPending === pending) this.identityPending = undefined;
    }
  }
  async owners(): Promise<GitHubOwner[]> {
    const read = async (cursor?: string) => {
      const { viewer } = await this.query(
        'query($cursor:String){viewer{id login organizations(first:100,after:$cursor){nodes{id login} pageInfo{hasNextPage endCursor}}}}',
        { cursor },
      );
      if (!viewer?.id || !viewer.login)
        throw new Error('GitHub account is not accessible. Sign in again.');
      return viewer;
    };
    const viewer = await read();
    const organizations = await completeConnection(viewer.organizations, async (cursor) => {
      const next = await read(cursor);
      if (next.id !== viewer.id)
        throw new Error('GitHub account changed during loading. Refresh the list.');
      return next.organizations;
    });
    return [
      { id: viewer.id, login: viewer.login, kind: 'user' },
      ...organizations.map((organization) => ({
        id: organization.id,
        login: organization.login,
        kind: 'organization' as const,
      })),
    ];
  }
  async list(owner: GitHubOwner): Promise<GitHubProject[]> {
    validateOwner(owner);
    const read = async (cursor?: string) => {
      const data = await this.query(
        `query($owner:String!,$cursor:String){${owner.kind}(login:$owner){projectsV2(first:100,after:$cursor){nodes{id title url number closed} pageInfo{hasNextPage endCursor}}}}`,
        { owner: owner.login, cursor },
      );
      const connection = data[owner.kind]?.projectsV2;
      if (!connection) throw new Error('This owner is not accessible to your GitHub account.');
      return connection;
    };
    const projects = await completeConnection(await read(), read);
    return projects
      .filter((project) => !project.closed)
      .map((project) => ({
        id: project.id,
        title: project.title,
        url: project.url,
        number: project.number,
        owner: owner.login,
      }));
  }
  async create(owner: GitHubOwner, title: string): Promise<GitHubProject> {
    validateOwner(owner);
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 256)
      throw new Error('Enter a project title of up to 256 characters.');
    // Resolve the owner again; do not trust a renderer-supplied node ID.
    const data = await this.query(`query($owner:String!){${owner.kind}(login:$owner){id}}`, {
      owner: owner.login,
    });
    if (!data[owner.kind]?.id) throw new Error('GitHub owner not found.');
    const result = await this.query(
      'mutation($owner:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,title:$title}){projectV2{id title url number}}}',
      { owner: data[owner.kind].id, title: title.trim() },
    );
    if (!result.createProjectV2?.projectV2)
      throw new Error(
        'GitHub did not return the created project. Refresh the list before retrying.',
      );
    return { ...result.createProjectV2.projectV2, owner: owner.login };
  }
  async resolve(url: string): Promise<GitHubProject> {
    const { owner, number, kind } = parseProjectURL(url);
    const data = await this.query(
      `query($owner:String!,$number:Int!){${kind}(login:$owner){projectV2(number:$number){id title url number closed}}}`,
      { owner, number },
    );
    const project = data[kind]?.projectV2;
    if (!project) throw new Error('Project not found or not accessible to your GitHub account.');
    if (project.closed) throw new Error('This GitHub project is closed.');
    return {
      id: project.id,
      title: project.title,
      url: project.url,
      number: project.number,
      owner,
    };
  }
  async board(project: GitHubProject, force = false): Promise<GitHubBoard> {
    const { key, generation } = await this.boardKey(project);
    const board = await this.boards.read(key, () => this.fetchBoard(project), force);
    if (generation !== this.generation)
      throw new Error('GitHub access or project data changed. Refresh this project.');
    return board;
  }
  private async fetchBoard(project: GitHubProject): Promise<GitHubBoard> {
    const items: GitHubItem[] = [];
    const archivedItems: GitHubItem[] = [];
    let restrictedItems = 0;
    let cursor: string | undefined;
    let statusField: GitHubBoard['statusField'];
    let fields: GitHubBoard['fields'];
    let writable = false;
    const seenCursors = new Set<string>();
    do {
      const data = await this.query(
        `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{title viewerCanUpdate fields(first:100){nodes{${fieldSelection}} pageInfo{hasNextPage endCursor}} items(first:${boardItemPage},after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isArchived content{__typename ... on Issue{title body url number repository{nameWithOwner}} ... on PullRequest{title body url number repository{nameWithOwner}} ... on DraftIssue{title body}} fieldValues(first:${boardValuePage}){nodes{${valueSelection}} pageInfo{hasNextPage endCursor}}}}}}}`,
        { id: project.id, cursor },
      );
      const node = data.node;
      writable = node?.viewerCanUpdate === true;
      if (!node?.items) throw new Error('Linked GitHub project is no longer accessible.');
      if (!fields) fields = await readFields(this.query, project.id, node.fields);
      statusField = workflowField(fields, project.statusFieldId);
      for (const row of node.items.nodes) {
        if (!row.content) {
          restrictedItems++;
          continue;
        }
        const values = await completeConnection(
          row.fieldValues,
          async (after) => {
            const data = await this.query(
              `query($id:ID!,$cursor:String){node(id:$id){
            ... on ProjectV2Item{fieldValues(first:100,after:$cursor){
              nodes{${valueSelection}} pageInfo{hasNextPage endCursor}}}}}`,
              { id: row.id, cursor: after },
            );
            return data.node?.fieldValues;
          },
          1000,
        );
        await completeFieldValues(this.query, project.id, row.id, values);
        const value = values.find((v: any) => v.field?.id === statusField?.id);
        (row.isArchived ? archivedItems : items).push({
          id: row.id,
          kind: row.content.__typename,
          archived: row.isArchived === true,
          title: row.content.title,
          body: row.content.body || '',
          url: row.content.url,
          repository: row.content.repository?.nameWithOwner,
          number: row.content.number,
          status: value?.name,
          statusId: value?.optionId,
          fieldValues: values,
        });
      }
      const info = node.items.pageInfo;
      if (items.length + archivedItems.length + restrictedItems > 10000)
        throw new Error('GitHub returned too many project items.');
      if (info.hasNextPage && (!info.endCursor || seenCursors.has(info.endCursor)))
        throw new Error('GitHub returned an invalid pagination cursor. Refresh the project.');
      if (info.endCursor) seenCursors.add(info.endCursor);
      cursor = info.hasNextPage ? info.endCursor : undefined;
    } while (cursor);
    const board = { project, items, archivedItems, restrictedItems, writable, fields, statusField };
    return {
      ...board,
      cache: {
        revision: createHash('sha256').update(JSON.stringify(board)).digest('hex'),
        fetchedAt: Date.now(),
      },
    };
  }
  async setStatus(project: GitHubProject, itemId: string, optionId: string) {
    const board = await this.board(project, true);
    if (
      !board.items.some((item) => item.id === itemId) ||
      !board.statusField?.options.some((option) => option.id === optionId)
    )
      throw new Error('Item or status no longer exists. Refresh the project.');
    const item = board.items.find((item) => item.id === itemId)!;
    const statusField = board.statusField!;
    const detail = {
      itemId,
      fieldId: statusField.id,
      before: projectFieldValue(item, statusField.id),
      value: { singleSelectOptionId: optionId },
    };
    try {
      await journalDetail.run(detail, () =>
        this.query(
          'mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}',
          { project: project.id, item: itemId, field: statusField.id, option: optionId },
        ),
      );
    } finally {
      this.invalidateBoards();
    }
  }
  async addDraft(project: GitHubProject, title: string, body: string) {
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 256 ||
      typeof body !== 'string' ||
      body.length > 20000
    )
      throw new Error(
        'Enter a title up to 256 characters and a description up to 20,000 characters.',
      );
    try {
      const data = await this.query(
        'mutation($project:ID!,$title:String!,$body:String!){addProjectV2DraftIssue(input:{projectId:$project,title:$title,body:$body}){projectItem{id}}}',
        { project: project.id, title: title.trim(), body },
      );
      return data.addProjectV2DraftIssue.projectItem.id as string;
    } finally {
      this.invalidateBoards();
    }
  }
  async addIssue(project: GitHubProject, value: string) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)\/?$/);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !match)
      throw new Error('Enter a github.com issue or pull request URL.');
    const data = await this.query(
      'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issueOrPullRequest(number:$number){... on Issue{id} ... on PullRequest{id}}}}',
      { owner: match[1], repo: match[2], number: Number(match[4]) },
    );
    const id = data.repository?.issueOrPullRequest?.id;
    if (!id) throw new Error('Issue or pull request not found.');
    try {
      await this.query(
        'mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}',
        { project: project.id, content: id },
      );
    } finally {
      this.invalidateBoards();
    }
  }
}

function validateOwner(owner: GitHubOwner) {
  if (
    !owner ||
    !['user', 'organization'].includes(owner.kind) ||
    typeof owner.login !== 'string' ||
    !/^[\w-]{1,100}$/.test(owner.login)
  )
    throw new Error('Choose a valid GitHub owner.');
}
