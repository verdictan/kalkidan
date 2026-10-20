import { createHash } from 'node:crypto';
import type { GraphQL } from '../github-projects';
import type { GitHubProject } from '../../src/domain/github';
import type { GitHubContentSnapshot, GitHubContentAction } from '../../src/domain/github-content';
import { completeConnection } from './github-fields';
import { validateProjectMutation } from './github-schema';
import { GitHubRequestError } from './request-scheduler';
const common =
  'id title body state updatedAt viewerCanUpdate viewerCanClose viewerCanReopen viewerCanAssign viewerCanLabel repository{id owner{login} name} milestone{id title}';
export class GitHubProjectContent {
  private pending = new Set<string>();
  constructor(
    private query: GraphQL,
    private changed: () => void,
  ) {}
  private async node(project: GitHubProject, item: string) {
    const data = await this.query(
      `query($item:ID!){node(id:$item){... on ProjectV2Item{project{id} content{__typename ... on Issue{${common} viewerCanSetMilestone viewerCanType issueType{id name}} ... on PullRequest{${common} mergeable reviewDecision headRefOid viewerDidAuthor commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`,
      { item },
    );
    const node = data.node?.content;
    if (
      data.node?.project?.id !== project.id ||
      !['Issue', 'PullRequest'].includes(node?.__typename)
    )
      throw new Error('This issue or pull request is no longer accessible in the project.');
    return node;
  }
  async read(project: GitHubProject, item: string): Promise<GitHubContentSnapshot> {
    const node = await this.node(project, item);
    const values: Record<string, any[]> = {};
    const selections: Record<string, string> = {
      assignees: 'id login',
      labels: 'id name',
      comments: 'id body url author{login}',
      ...(node.__typename === 'PullRequest' ? { reviews: 'id state body author{login}' } : {}),
      ...(node.__typename === 'Issue'
        ? {
            closedByPullRequestsReferences:
              'id title url state merged headRefOid reviewDecision statusCheckRollup{state}',
          }
        : {}),
    };
    for (const [key, selection] of Object.entries(selections)) {
      const page = async (cursor?: string) => {
        const result = await this.query(
          `query($id:ID!,$cursor:String){node(id:$id){... on ${node.__typename}{id ${key}(first:100,after:$cursor${key === 'closedByPullRequestsReferences' ? ',includeClosedPrs:true' : ''}){nodes{${selection}} pageInfo{hasNextPage endCursor}}}}}`,
          { id: node.id, cursor },
        );
        if (result.node?.id !== node.id) throw new Error('Content access changed.');
        return result.node[key];
      };
      values[key] = await completeConnection(await page(), page, 10000);
    }
    const checkEvidence =
      node.__typename === 'PullRequest' ? await this.checks(node.id, node.headRefOid) : undefined;
    const linkedPullRequests = [];
    for (const pr of values.closedByPullRequestsReferences || [])
      linkedPullRequests.push({
        ...pr,
        checks: pr.statusCheckRollup?.state,
        checkEvidence: await this.checks(pr.id, pr.headRefOid),
      });
    const repositoryPage = async (key: 'milestones' | 'issueTypes', cursor?: string) => {
      const data = await this.query(
        `query($id:ID!,$cursor:String){node(id:$id){... on Repository{id ${key}(first:100,after:$cursor){nodes{id ${key === 'milestones' ? 'title' : 'name'}} pageInfo{hasNextPage endCursor}}}}}`,
        { id: node.repository.id, cursor },
      );
      if (data.node?.id !== node.repository.id) throw new Error('Repository access changed.');
      return data.node[key];
    };
    const milestones = await completeConnection(
      await repositoryPage('milestones'),
      (cursor) => repositoryPage('milestones', cursor),
      10000,
    );
    const issueTypes =
      node.__typename === 'Issue'
        ? await completeConnection(
            await repositoryPage('issueTypes'),
            (cursor) => repositoryPage('issueTypes', cursor),
            1000,
          )
        : undefined;
    const value = {
      checkEvidence,
      linkedPullRequests,
      id: node.id,
      kind: node.__typename,
      title: node.title,
      body: node.body,
      state: node.state,
      permissions: {
        edit: node.viewerCanUpdate === true,
        close: node.viewerCanClose === true,
        reopen: node.viewerCanReopen === true,
        assign: node.viewerCanAssign === true,
        label: node.viewerCanLabel === true,
      },
      milestones,
      issueTypes,
      headOid: node.headRefOid,
      checks: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state,
      canSetMilestone:
        node.__typename === 'Issue'
          ? node.viewerCanSetMilestone === true
          : node.viewerCanUpdate === true,
      canSetType: node.viewerCanType === true,
      viewerDidAuthor: node.viewerDidAuthor === true,
      assignees: values.assignees,
      labels: values.labels,
      comments: values.comments,
      milestone: node.milestone,
      issueType: node.issueType,
      mergeable: node.mergeable,
      reviewDecision: node.reviewDecision,
      reviews: values.reviews,
    };
    return {
      ...value,
      revision: createHash('sha256')
        .update(JSON.stringify([node.updatedAt, value]))
        .digest('hex'),
    };
  }
  private async checks(id: string, head: string) {
    const page = async (cursor?: string) => {
      const data = await this.query(
        'query($id:ID!,$cursor:String){node(id:$id){... on PullRequest{id headRefOid statusCheckRollup{contexts(first:100,after:$cursor){nodes{__typename ... on StatusContext{context state targetUrl} ... on CheckRun{name status conclusion detailsUrl}} pageInfo{hasNextPage endCursor}}}}}}',
        { id, cursor },
      );
      if (data.node?.id !== id || data.node.headRefOid !== head)
        throw new Error(
          'The pull request head changed while reading checks. Refresh the evidence.',
        );
      return (
        data.node.statusCheckRollup?.contexts || { nodes: [], pageInfo: { hasNextPage: false } }
      );
    };
    const rows = await completeConnection(await page(), page, 10000);
    return rows.map((row) => ({
      name: row.context || row.name || 'Unknown check',
      state: row.state || row.conclusion || row.status || 'UNKNOWN',
      url: /^https:\/\//.test(row.targetUrl || row.detailsUrl || '')
        ? row.targetUrl || row.detailsUrl
        : undefined,
      kind: row.__typename === 'StatusContext' ? ('status' as const) : ('check' as const),
    }));
  }
  async change(
    project: GitHubProject,
    item: string,
    revision: string,
    action: GitHubContentAction,
  ) {
    const key = `${project.id}:${item}`;
    if (
      !action ||
      ![
        'edit',
        'comment',
        'close',
        'reopen',
        'assign',
        'unassign',
        'label',
        'unlabel',
        'milestone',
        'issue-type',
        'request-review',
        'review',
      ].includes(action.kind)
    )
      throw new Error('Invalid content action.');
    if (this.pending.has(key)) throw new Error('A content change is already in progress.');
    this.pending.add(key);
    try {
      const current = await this.read(project, item);
      if (current.revision !== revision)
        throw new Error('The content changed. Reload before saving.');
      let method: string;
      let input: Record<string, unknown>;
      if (action.kind === 'milestone' || action.kind === 'issue-type') {
        const milestone = action.kind === 'milestone';
        if (milestone ? !current.canSetMilestone : current.kind !== 'Issue' || !current.canSetType)
          throw new Error('You cannot change this field.');
        const choices = milestone ? current.milestones : current.issueTypes;
        if (action.id !== null && !choices?.some((choice) => choice.id === action.id))
          throw new Error('Choose a value from this repository.');
        method = `update${current.kind}`;
        input = {
          [current.kind === 'Issue' ? 'id' : 'pullRequestId']: current.id,
          [milestone ? 'milestoneId' : 'issueTypeId']: action.id,
        };
      } else if (action.kind === 'request-review') {
        if (
          current.kind !== 'PullRequest' ||
          current.state !== 'OPEN' ||
          !current.permissions.edit ||
          !/^[a-zA-Z0-9-]{1,100}$/.test(action.login)
        )
          throw new Error('Choose a reviewer for an open pull request.');
        const user = (
          await this.query('query($login:String!){user(login:$login){id}}', { login: action.login })
        ).user;
        if (!user?.id) throw new Error('The reviewer is not accessible.');
        method = 'requestReviews';
        input = { pullRequestId: current.id, userIds: [user.id], union: true };
      } else if (action.kind === 'review') {
        if (
          current.kind !== 'PullRequest' ||
          current.state !== 'OPEN' ||
          !current.headOid ||
          action.headOid !== current.headOid
        )
          throw new Error('The pull request head changed. Reload before reviewing.');
        if (
          !['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(action.event) ||
          typeof action.body !== 'string' ||
          action.body.length > 20000 ||
          (action.event !== 'APPROVE' && !action.body.trim())
        )
          throw new Error('Enter a review up to 20,000 characters.');
        if (current.viewerDidAuthor && action.event !== 'COMMENT')
          throw new Error('You cannot approve or reject your own pull request.');
        method = 'addPullRequestReview';
        input = {
          pullRequestId: current.id,
          commitOID: current.headOid,
          event: action.event,
          body: action.body,
        };
      } else if (action.kind === 'edit') {
        if (!current.permissions.edit) throw new Error('You cannot edit this content.');
        if (
          typeof action.title !== 'string' ||
          !action.title.trim() ||
          action.title.length > 256 ||
          typeof action.body !== 'string' ||
          action.body.length > 20000
        )
          throw new Error('Enter a title and a description up to 20,000 characters.');
        method = `update${current.kind}`;
        input = {
          [current.kind === 'Issue' ? 'id' : 'pullRequestId']: current.id,
          title: action.title.trim(),
          body: action.body,
        };
      } else if (action.kind === 'comment') {
        if (typeof action.body !== 'string' || !action.body.trim() || action.body.length > 20000)
          throw new Error('Enter a comment up to 20,000 characters.');
        method = 'addComment';
        input = { subjectId: current.id, body: action.body };
      } else if (action.kind === 'close' || action.kind === 'reopen') {
        if (!current.permissions[action.kind]) throw new Error('You cannot change this state.');
        method = `${action.kind}${current.kind}`;
        input = { [current.kind === 'Issue' ? 'issueId' : 'pullRequestId']: current.id };
      } else if ('login' in action) {
        if (!current.permissions.assign || !/^[a-zA-Z0-9-]{1,100}$/.test(action.login))
          throw new Error('Choose an assignable user.');
        const user = (
          await this.query('query($login:String!){user(login:$login){id}}', { login: action.login })
        ).user;
        if (!user?.id) throw new Error('The user is not accessible.');
        method =
          action.kind === 'assign' ? 'addAssigneesToAssignable' : 'removeAssigneesFromAssignable';
        input = { assignableId: current.id, assigneeIds: [user.id] };
      } else if ('name' in action) {
        if (
          !current.permissions.label ||
          typeof action.name !== 'string' ||
          !action.name.trim() ||
          action.name.length > 100
        )
          throw new Error('Choose a repository label.');
        const node = await this.node(project, item);
        const repo = node.repository;
        const label = (
          await this.query(
            'query($owner:String!,$name:String!,$label:String!){repository(owner:$owner,name:$name){label(name:$label){id}}}',
            { owner: repo.owner.login, name: repo.name, label: action.name },
          )
        ).repository?.label;
        if (!label?.id) throw new Error('The label does not exist in this repository.');
        method = action.kind === 'label' ? 'addLabelsToLabelable' : 'removeLabelsFromLabelable';
        input = { labelableId: current.id, labelIds: [label.id] };
      } else throw new Error('Invalid content action.');
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
