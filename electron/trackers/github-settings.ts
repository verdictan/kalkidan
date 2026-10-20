import { createHash } from 'node:crypto';
import type { GraphQL } from '../github-projects';
import type { GitHubProject } from '../../src/domain/github';
import type {
  ProjectSettings,
  ProjectSettingsAction,
  ProjectAdminAction,
  ProjectAdminResult,
} from '../../src/domain/github-mutations';
import { completeConnection } from './github-fields';
import { validateProjectMutation } from './github-schema';
import { GitHubRequestError } from './request-scheduler';

/** Fresh revisions prevent an old form from replacing newer project settings. */
export class GitHubProjectSettings {
  private pending = new Set<string>();
  constructor(
    private query: GraphQL,
    private changed: () => void,
  ) {}

  async read(project: GitHubProject): Promise<ProjectSettings> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(project.id)) throw new Error('Invalid project ID.');
    const { node } = await this.query(
      `query($id:ID!){node(id:$id){... on ProjectV2{
        id title shortDescription readme closed public template viewerCanUpdate updatedAt
        repositories(first:100){nodes{id nameWithOwner} pageInfo{hasNextPage endCursor}}
        teams(first:100){nodes{id name slug organization{login}} pageInfo{hasNextPage endCursor}}
      }}}`,
      { id: project.id },
    );
    if (
      node?.id !== project.id ||
      typeof node.title !== 'string' ||
      ['closed', 'public', 'template', 'viewerCanUpdate'].some(
        (key) => typeof node[key] !== 'boolean',
      )
    )
      throw new Error('GitHub project settings are not accessible.');
    const repositories = await completeConnection(
      node.repositories,
      async (cursor) => {
        const page = await this.query(
          `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{
        id repositories(first:100,after:$cursor){nodes{id nameWithOwner} pageInfo{hasNextPage endCursor}}
      }}}`,
          { id: project.id, cursor },
        );
        if (page.node?.id !== project.id)
          throw new Error('Project access changed. Reload settings.');
        return page.node.repositories;
      },
      1000,
    );
    const teams = await completeConnection(
      node.teams,
      async (cursor) => {
        const page = await this.query(
          `query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{id teams(first:100,after:$cursor){nodes{id name slug organization{login}} pageInfo{hasNextPage endCursor}}}}}`,
          { id: project.id, cursor },
        );
        if (page.node?.id !== project.id)
          throw new Error('Project access changed. Reload settings.');
        return page.node.teams;
      },
      1000,
    );
    if (
      teams.some(
        (team) =>
          typeof team.id !== 'string' ||
          typeof team.slug !== 'string' ||
          typeof team.organization?.login !== 'string',
      )
    )
      throw new Error('GitHub returned incomplete team links.');
    if (
      repositories.some(
        (repo) => typeof repo.id !== 'string' || typeof repo.nameWithOwner !== 'string',
      )
    )
      throw new Error('GitHub returned incomplete repository links.');
    const value = {
      teams: teams.map((team) => ({
        id: team.id as string,
        name: team.name as string,
        slug: team.slug as string,
        organization: team.organization.login as string,
      })),
      repositories: repositories.map(({ id, nameWithOwner }) => ({
        id: id as string,
        nameWithOwner: nameWithOwner as string,
      })),
      id: node.id as string,
      title: node.title as string,
      shortDescription: node.shortDescription || '',
      readme: node.readme || '',
      closed: node.closed as boolean,
      public: node.public as boolean,
      template: node.template as boolean,
      writable: node.viewerCanUpdate as boolean,
    };
    return {
      ...value,
      revision: createHash('sha256')
        .update(JSON.stringify([value, node.updatedAt]))
        .digest('hex'),
    };
  }

  async administer(
    project: GitHubProject,
    revision: string,
    action: ProjectAdminAction,
  ): Promise<ProjectAdminResult> {
    if (!action || typeof action !== 'object' || typeof revision !== 'string')
      throw new Error('Invalid administration request.');
    if (this.pending.has(project.id)) throw new Error('Project settings are being saved.');
    this.pending.add(project.id);
    try {
      const current = await this.read(project);
      if (!current.writable) throw new Error('You do not have permission to change this project.');
      if (revision !== current.revision)
        throw new Error('Project settings changed on GitHub. Reload before saving.');
      let method: string;
      let input: Record<string, unknown> = { projectId: project.id };
      let selection = 'clientMutationId';
      const login = (value: unknown): value is string =>
        typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value);
      if (action.kind === 'copy') {
        if (
          !login(action.owner) ||
          typeof action.title !== 'string' ||
          !action.title.trim() ||
          action.title.length > 256 ||
          typeof action.includeDraftIssues !== 'boolean'
        )
          throw new Error('Enter a valid owner and project title.');
        const owner = await this.query('query($login:String!){repositoryOwner(login:$login){id}}', {
          login: action.owner,
        });
        if (!owner.repositoryOwner?.id) throw new Error('The destination owner is not accessible.');
        method = 'copyProjectV2';
        input = {
          ...input,
          ownerId: owner.repositoryOwner.id,
          title: action.title.trim(),
          includeDraftIssues: action.includeDraftIssues,
        };
        selection += ' projectV2{url}';
      } else if (action.kind === 'delete') {
        if (action.confirmation !== current.title)
          throw new Error('Type the current project title to confirm deletion.');
        method = 'deleteProjectV2';
      } else if (action.kind === 'team' || action.kind === 'team-collaborator') {
        if (
          !login(action.organization) ||
          !login(action.slug) ||
          (action.kind === 'team' && typeof action.linked !== 'boolean')
        )
          throw new Error('Enter the organization and team slug.');
        const data = await this.query(
          `query($id:ID!,$organization:String!,$slug:String!){
          node(id:$id){... on ProjectV2{owner{... on Organization{login}}}}
          organization(login:$organization){team(slug:$slug){id}}
        }`,
          { id: project.id, organization: action.organization, slug: action.slug },
        );
        if (
          data.node?.owner?.login?.toLowerCase() !== action.organization.toLowerCase() ||
          !data.organization?.team?.id
        )
          throw new Error('Choose a team from the project organization.');
        const teamId = data.organization.team.id;
        method =
          action.kind === 'team'
            ? action.linked
              ? 'linkProjectV2ToTeam'
              : 'unlinkProjectV2FromTeam'
            : 'updateProjectV2Collaborators';
        input =
          action.kind === 'team'
            ? { ...input, teamId }
            : { ...input, collaborators: [{ teamId, role: action.role }] };
      } else if (action.kind === 'collaborator') {
        if (!login(action.user)) throw new Error('Enter a GitHub user name.');
        const data = await this.query('query($login:String!){user(login:$login){id}}', {
          login: action.user,
        });
        if (!data.user?.id) throw new Error('The GitHub user was not found.');
        method = 'updateProjectV2Collaborators';
        input = { ...input, collaborators: [{ userId: data.user.id, role: action.role }] };
      } else throw new Error('Invalid administration action.');
      validateProjectMutation(method, input);
      const inputType = method[0].toUpperCase() + method.slice(1) + 'Input';
      const data = await this.query(
        `mutation($input:${inputType}!){${method}(input:$input){${selection}}}`,
        { input },
      );
      if (!data?.[method]) throw new GitHubRequestError('unknown-outcome');
      if (action.kind === 'copy') {
        const url = data[method].projectV2?.url;
        if (
          typeof url !== 'string' ||
          !/^https:\/\/github\.com\/(orgs|users)\/[^/]+\/projects\/\d+$/.test(url)
        )
          throw new GitHubRequestError('unknown-outcome');
        return { url };
      }
      return action.kind === 'delete' ? { deleted: true } : {};
    } finally {
      this.pending.delete(project.id);
      this.changed();
    }
  }

  async update(project: GitHubProject, revision: string, action: ProjectSettingsAction) {
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
      throw new Error('Reload project settings before saving.');
    if (!action || typeof action !== 'object') throw new Error('Invalid project settings.');
    let method: string;
    let input: Record<string, unknown>;
    if (action.kind === 'update') {
      if (
        Object.keys(action).some(
          (key) =>
            !['kind', 'title', 'shortDescription', 'readme', 'closed', 'public'].includes(key),
        ) ||
        typeof action.title !== 'string' ||
        !action.title.trim() ||
        action.title.length > 256 ||
        typeof action.shortDescription !== 'string' ||
        action.shortDescription.length > 256 ||
        typeof action.readme !== 'string' ||
        action.readme.length > 20000 ||
        typeof action.closed !== 'boolean' ||
        typeof action.public !== 'boolean'
      )
        throw new Error(
          'Enter valid project settings. Use at most 256 characters for the title and summary, and 20,000 for the description.',
        );
      method = 'updateProjectV2';
      input = {
        projectId: project.id,
        title: action.title.trim(),
        shortDescription: action.shortDescription,
        readme: action.readme,
        closed: action.closed,
        public: action.public,
      };
    } else if (
      action.kind === 'template' &&
      typeof action.enabled === 'boolean' &&
      Object.keys(action).every((key) => ['kind', 'enabled'].includes(key))
    ) {
      method = action.enabled ? 'markProjectV2AsTemplate' : 'unmarkProjectV2AsTemplate';
      input = { projectId: project.id };
    } else if (
      action.kind === 'repository' &&
      typeof action.linked === 'boolean' &&
      typeof action.nameWithOwner === 'string' &&
      /^[\w.-]+\/[\w.-]+$/.test(action.nameWithOwner) &&
      Object.keys(action).every((key) => ['kind', 'nameWithOwner', 'linked'].includes(key))
    ) {
      method = action.linked ? 'linkProjectV2ToRepository' : 'unlinkProjectV2FromRepository';
      input = { projectId: project.id };
    } else throw new Error('Invalid project settings action.');
    if (this.pending.has(project.id)) throw new Error('Project settings are being saved.');
    this.pending.add(project.id);
    try {
      const current = await this.read(project);
      if (!current.writable) throw new Error('You do not have permission to change this project.');
      if (current.revision !== revision)
        throw new Error('Project settings changed on GitHub. Reload before saving.');
      if (action.kind === 'repository') {
        const existing = current.repositories.find(
          (repo) => repo.nameWithOwner.toLowerCase() === action.nameWithOwner.toLowerCase(),
        );
        if (!!existing === action.linked) return current;
        if (existing) input.repositoryId = existing.id;
        else {
          const [owner, name] = action.nameWithOwner.split('/');
          const data = await this.query(
            'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id viewerPermission}}',
            { owner, name },
          );
          if (
            !data.repository?.id ||
            !['ADMIN', 'MAINTAIN', 'WRITE'].includes(data.repository.viewerPermission)
          )
            throw new Error('You need write access to link this repository.');
          input.repositoryId = data.repository.id;
        }
      }
      validateProjectMutation(method, input);
      const inputType = method[0].toUpperCase() + method.slice(1) + 'Input';
      const result = await this.query(
        `mutation($input:${inputType}!){${method}(input:$input){clientMutationId}}`,
        { input },
      );
      if (!result?.[method]) throw new GitHubRequestError('unknown-outcome');
      // Do not replay a write if this read fails. The caller must refresh first.
      return await this.read(project);
    } finally {
      this.pending.delete(project.id);
      this.changed();
    }
  }
}
