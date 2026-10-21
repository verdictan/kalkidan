import type { DocPassage, ProjectDoc } from './domain/docs';
import type { MemoryEntry } from './domain/memory';
import type { DispatchPlan } from './domain/parallel-dispatch';
import type { GitHubContentSnapshot } from './domain/github-content';
import { canRevertMutation, type GitHubMutationHistory } from './domain/project-batch';
import { githubDescriptor } from './domain/tracker';
import { managedOnlyNotice } from './domain/verdictan';
import type { API, Project, Session, ProjectGroup } from './types';
const now = new Date().toISOString();
let projects: Project[] = [
  {
    id: '1',
    name: 'atlas-web',
    path: '/Users/you/Developer/atlas-web',
    favorite: true,
    notes:
      'Customer-facing app. Keep shared implementation decisions in AGENTS.md and agent-specific guidance in CLAUDE.md.',
    addedAt: now,
  },
  {
    id: '2',
    name: 'design-system',
    path: '/Users/you/Developer/design-system',
    favorite: true,
    notes: '',
    addedAt: now,
  },
  {
    id: '3',
    name: 'api-service',
    path: '/Users/you/Developer/api-service',
    favorite: false,
    notes: '',
    addedAt: now,
  },
];
let groups: ProjectGroup[] = [{ id: 'atlas', name: 'Atlas', repoIds: ['1', '2', '3'] }];
const sessions: Session[] = [
  {
    id: 'demo-session',
    agent: 'codex',
    cwd: projects[0].path,
    updatedAt: now,
    title: 'Refine project and repository navigation',
  },
  {
    id: 'demo-claude',
    agent: 'claude',
    cwd: projects[0].path,
    updatedAt: now,
    title: 'Review the authentication flow and add integration tests',
  },
];
const board = {
  project: {
    id: 'demo-project',
    title: 'Atlas roadmap',
    url: 'https://github.com/orgs/example/projects/1',
    owner: 'example',
    number: 1,
  },
  statusField: {
    id: 'status',
    options: [
      { id: 'todo', name: 'Todo' },
      { id: 'progress', name: 'In progress' },
      { id: 'done', name: 'Done' },
    ],
  },
  items: [
    {
      id: 'task-1',
      title: 'Build the project overview',
      body: 'Bring repositories, sessions, and planning into one project view.',
      repository: 'example/atlas-web',
      status: 'In progress',
      statusId: 'progress',
    },
    {
      id: 'task-2',
      title: 'Review authentication',
      body: 'Review the sign-in flow and add integration tests.',
      repository: 'example/api-service',
      status: 'Todo',
      statusId: 'todo',
    },
  ],
};
// The names of the sample repositories that the preview finds in any folder.
const scanNames = [
  { name: 'atlas-web', branch: 'main' },
  { name: 'design-system', branch: 'main' },
  { name: 'api-service', branch: 'feature/rate-limits' },
];
const folderPath = (path: string) => path.replace(/\/+$/, '') || '/';
/** A simple check like `git check-ref-format --branch` for the preview. */
function previewBranch(branch: string) {
  if (
    typeof branch !== 'string' ||
    !branch.trim() ||
    branch.startsWith('-') ||
    branch.length > 200 ||
    /\.\.|[\s~^:?*[\\]|\/$|\.$|^\/|\.lock$|@\{/.test(branch)
  )
    throw new Error(`"${branch}" is not a valid branch name.`);
  return branch;
}
/** The browser preview never starts an agent. Agents run only as managed Verdictan agents. */
const previewAgentBlock = `${managedOnlyNotice} The browser preview cannot start managed agents. Open the desktop app and complete managed agent setup.`;
const nativeOnly = async () => {
  throw new Error('Open the desktop app to use native folder and Terminal actions.');
};
function previewProvider<T>(id: string, action: () => Promise<T>): Promise<T> {
  return id === 'github'
    ? action()
    : Promise.reject(new Error(`Tracker ${id} is not available in this preview.`));
}
const demoDocs: Record<string, ProjectDoc[]> = JSON.parse(
  localStorage.getItem('kalkidan-demo-docs') || '{}',
);
// Deleted preview pages stay in memory for this browser tab only.
const demoTrash: Record<string, { doc: ProjectDoc; deletedAt: number }[]> = {};
function persistDocs() {
  localStorage.setItem('kalkidan-demo-docs', JSON.stringify(demoDocs));
}
const demoTaskLinks: Record<string, Record<string, string[]>> = (() => {
  try {
    return JSON.parse(localStorage.getItem('kalkidan-demo-task-links') || '{}');
  } catch {
    return {};
  }
})();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const demoMemoryId = (n: number) => String(n).padStart(64, 'a');
let demoMemory: MemoryEntry[] = [
  {
    version: 1,
    id: demoMemoryId(1),
    topic: 'Testing',
    content: 'Run npm test and npm run test:ui before you open a pull request.',
    revision: demoMemoryId(11),
    provenance: 'verified',
    source: { sessionId: 'demo-session', turnId: 'turn-3', references: [] },
    createdAt: minutesAgo(2880),
    updatedAt: minutesAgo(2880),
    supersedes: [],
  },
  {
    version: 1,
    id: demoMemoryId(2),
    topic: 'Authentication',
    content: 'The API service signs sessions with a 15-minute access token and a refresh token.',
    revision: demoMemoryId(12),
    provenance: 'verified',
    source: { sessionId: 'demo-claude', turnId: 'turn-7', references: [] },
    createdAt: minutesAgo(720),
    updatedAt: minutesAgo(720),
    supersedes: [],
  },
  {
    version: 1,
    id: demoMemoryId(3),
    topic: 'Design tokens',
    content: 'Colors come from design-system tokens. Do not add raw hex values in atlas-web.',
    revision: demoMemoryId(13),
    provenance: 'legacy',
    source: { sessionId: '', turnId: '', references: [] },
    createdAt: minutesAgo(10080),
    updatedAt: minutesAgo(10080),
    supersedes: [],
  },
];
let demoWrites: GitHubMutationHistory = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    operation: 'updateStatus',
    state: 'confirmed',
    updatedAt: Date.now() - 3 * 3600000,
    detail: {
      itemId: 'task-1',
      fieldId: 'status',
      before: { singleSelectOptionId: 'todo' },
      value: { singleSelectOptionId: 'progress' },
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    operation: 'addComment',
    state: 'unknown-outcome',
    updatedAt: Date.now() - 40 * 60000,
    detail: { itemId: 'task-2' },
  },
];
function demoStatusWrite(item: string, before: string, value: string, revertOf?: string) {
  const id = crypto.randomUUID();
  demoWrites = [
    ...demoWrites,
    {
      id,
      operation: 'updateStatus',
      state: 'confirmed',
      updatedAt: Date.now(),
      detail: {
        itemId: item,
        fieldId: 'status',
        before: { singleSelectOptionId: before },
        value: { singleSelectOptionId: value },
        ...(revertOf ? { revertOf } : {}),
      },
    },
  ];
  return id;
}
const demoDispatches = new Map<string, { plan: DispatchPlan; startedAt: number }>();
function demoDispatch(id: string) {
  const entry = demoDispatches.get(id);
  if (!entry) throw new Error('This parallel run is no longer available. Prepare it again.');
  return entry;
}
const demoContent = new Map<string, GitHubContentSnapshot>();
function demoContentFor(item: string): GitHubContentSnapshot {
  const task = board.items.find((value) => value.id === item);
  if (!task) throw new Error('This issue or pull request is no longer accessible in the project.');
  let content = demoContent.get(item);
  if (!content) {
    content = {
      id: 'content-' + item,
      kind: 'Issue',
      title: task.title,
      body: task.body,
      state: 'OPEN',
      revision: crypto.randomUUID(),
      permissions: { edit: true, close: true, reopen: true, assign: true, label: true },
      canSetMilestone: true,
      canSetType: true,
      milestones: [{ id: 'milestone-1', title: 'Launch' }],
      issueTypes: [
        { id: 'type-task', name: 'Task' },
        { id: 'type-bug', name: 'Bug' },
      ],
      milestone: { id: 'milestone-1', title: 'Launch' },
      issueType: { id: 'type-task', name: 'Task' },
      assignees: [{ id: 'user-you', login: 'you' }],
      labels: [
        { id: 'label-frontend', name: 'frontend', color: '1d76db' },
        { id: 'label-priority', name: 'priority', color: 'd93f0b' },
      ],
      comments: [
        {
          id: 'comment-1',
          body: 'The overview should show the open chats for each code folder.',
          url: 'https://github.com/example/atlas-web/issues/12#issuecomment-1',
          createdAt: minutesAgo(1440),
          author: { login: 'maria' },
        },
      ],
      linkedPullRequests: [],
    };
    demoContent.set(item, content);
  }
  return content;
}
export const demo: API = {
  taskUsageHistory: async () => [],
  managedHistory: async () => ({
    entries: [],
    cursor: null,
    asOf: null,
    observedAt: new Date().toISOString(),
  }),
  projectPublishDoc: async () => {
    throw new Error('Knowledge publication requires the desktop app.');
  },
  projectServicesStatus: async () => ({
    available: false,
    operations: [],
    permissions: [],
    message: 'Project services require a compatible desktop runtime.',
  }),
  projectServicesRequest: async () => {
    throw new Error('Project services require the desktop app.');
  },
  verdictanSetup: async () => ({
    status: 'desktop_required',
    teams: [],
    policies: [],
    providerConnections: [],
    selections: {},
  }),
  verdictanSelect: async () => {
    throw new Error('Open the desktop app to configure Verdictan.');
  },
  verdictanSetRegion: async () => {
    throw Error('Region selection requires the desktop app.');
  },
  verdictanStatus: async () => ({ phase: 'missing', executionReady: false }),
  verdictanCheck: async () => ({
    phase: 'missing',
    executionReady: false,
    error: 'Desktop application required.',
  }),
  verdictanAuthorize: async () => {
    throw new Error('Open the desktop application to sign in.');
  },
  verdictanCancel: async () => ({ phase: 'missing', executionReady: false }),
  verdictanRenew: async () => {
    throw new Error('Open the desktop application to renew your session.');
  },
  verdictanLogout: async () => ({ phase: 'missing', executionReady: false }),
  componentUpdates: async () => ({
    desktop: {
      installedVersion: 'Browser preview',
      runningVersion: 'Browser preview',
      runningBuild: 'preview',
      discovery: 'unsupported',
      stale: false,
      install: {
        kind: 'development',
        selfUpdate: false,
        reason: 'The browser preview cannot install updates. Open the desktop app.',
      },
    },
    helpers: [],
  }),
  runtimeUpdateStatus: async (hostId) => ({
    hostId: hostId || 'local',
    component: 'verdictan',
    discovery: 'unknown',
    stale: true,
    history: [],
    latest: { version: '0.6.6', releaseId: 'preview', sha256: '0'.repeat(64) },
    canInstall: false,
    reason: 'Open the desktop app to install managed agents.',
  }),
  runtimeUpdateCheck: async (hostId) => demo.runtimeUpdateStatus(hostId),
  runtimeUpdateInstall: async () => {
    throw new Error('Runtime installation requires the desktop application.');
  },
  runtimeUpdateCancel: async (hostId) => demo.runtimeUpdateStatus(hostId),
  desktopUpdateDownload: async () => {
    throw new Error('Desktop updates require the desktop application.');
  },
  desktopUpdateCancel: async () => (await demo.componentUpdates()).desktop,
  desktopUpdateRestart: async () => {
    throw new Error('Desktop updates require the desktop application.');
  },
  memoryList: async () => ({
    pages: demoMemory.map((entry) => ({
      topic: entry.topic,
      provenance: entry.provenance,
      name: entry.id + '.md',
      content: entry.content,
      updatedAt: entry.updatedAt,
      truncated: false,
    })),
    limited: false,
  }),
  memoryEntries: async () => structuredClone(demoMemory),
  memoryForget: async (_group, id, revision) => {
    const entry = demoMemory.find((value) => value.id === id);
    if (!entry) throw new Error('Memory entry not found. Reload memory.');
    if (entry.revision !== revision)
      throw new Error('This memory entry changed. Reload memory and try again.');
    demoMemory = demoMemory.filter((value) => value.id !== id);
  },
  docsSearch: async (group, query, limit = 8) => {
    const terms = query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
    if (!terms.length) return [];
    const results: (DocPassage & { score: number })[] = [];
    for (const doc of demoDocs[group] || []) {
      let heading = '';
      for (const section of doc.markdown.split(/\n(?=#{1,6}\s)/)) {
        heading = section.match(/^#{1,6}\s+(.+)/)?.[1] || heading;
        const text = (doc.title + ' ' + section).toLowerCase();
        const score = terms.filter((term) => text.includes(term)).length;
        if (!score) continue;
        const flat = section
          .replace(/^#{1,6}\s+.+/, '')
          .replace(/\s+/g, ' ')
          .trim();
        results.push({
          id: doc.id,
          title: doc.title,
          heading,
          revision: doc.revision,
          source: `docs/${doc.id}.md`,
          excerpt: flat.length > 240 ? flat.slice(0, 240) + '…' : flat,
          score,
        });
      }
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...passage }) => passage);
  },
  taskDocLinks: async (group) => {
    const pages = new Set((demoDocs[group] || []).map((doc) => doc.id));
    return Object.fromEntries(
      Object.entries(demoTaskLinks[group] || {})
        .map(([item, ids]) => [item, ids.filter((id) => pages.has(id))] as const)
        .filter(([, ids]) => ids.length),
    );
  },
  setTaskDocLinks: async (group, itemId, docIds) => {
    const links = (demoTaskLinks[group] ||= {});
    if (docIds.length) links[itemId] = [...new Set(docIds)];
    else delete links[itemId];
    localStorage.setItem('kalkidan-demo-task-links', JSON.stringify(demoTaskLinks));
  },
  pullRequestStatus: async (_id, url) => {
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
    if (!number) throw new Error('Enter a pull request link.');
    return { state: 'open', number, title: 'Build the project overview' };
  },
  docsMetadata: async (group) =>
    (demoDocs[group] || []).map(({ id, title, parentId, order }) => ({
      id,
      title,
      parentId,
      ...(order === undefined ? {} : { order }),
    })),
  docsRead: async (group, id) => {
    const doc = demoDocs[group]?.find((doc) => doc.id === id);
    if (!doc) throw new Error('Page not found');
    return structuredClone(doc);
  },
  docsList: async (group) => structuredClone(demoDocs[group] || []),
  docsCreate: async (group, title, parentId) => {
    const doc = {
      id: crypto.randomUUID(),
      title,
      parentId,
      markdown: '',
      revision: crypto.randomUUID(),
    };
    (demoDocs[group] ||= []).push(doc);
    persistDocs();
    return structuredClone(doc);
  },
  docsSave: async (group, doc) => {
    const pages = demoDocs[group] || [];
    const index = pages.findIndex((p) => p.id === doc.id);
    if (index < 0 || pages[index].revision !== doc.revision)
      throw new Error('Page changed. Reopen it before saving.');
    pages[index] = { ...doc, revision: crypto.randomUUID() };
    persistDocs();
    return structuredClone(pages[index]);
  },
  docsDelete: async (group, id) => {
    if (demoDocs[group]?.some((p) => p.parentId === id))
      throw new Error('Move or delete child pages first.');
    const deleted = demoDocs[group]?.find((p) => p.id === id);
    if (deleted) (demoTrash[group] ||= []).push({ doc: deleted, deletedAt: Date.now() });
    demoDocs[group] = (demoDocs[group] || []).filter((p) => p.id !== id);
    persistDocs();
  },
  docsTrash: async (group) =>
    (demoTrash[group] || [])
      .map(({ doc, deletedAt }) => ({
        trashId: doc.id + '-' + deletedAt,
        id: doc.id,
        title: doc.title,
        deletedAt,
      }))
      .sort((a, b) => b.deletedAt - a.deletedAt),
  docsRestore: async (group, trashId) => {
    const items = demoTrash[group] || [];
    const index = items.findIndex(({ doc, deletedAt }) => doc.id + '-' + deletedAt === trashId);
    if (index < 0) throw new Error('Deleted page not found');
    const [{ doc }] = items.splice(index, 1);
    const pages = (demoDocs[group] ||= []);
    const restored = {
      ...doc,
      parentId: pages.some((p) => p.id === doc.parentId) ? doc.parentId : null,
      revision: crypto.randomUUID(),
    };
    pages.push(restored);
    persistDocs();
    return structuredClone(restored);
  },
  trackerProviders: async () => [githubDescriptor],
  trackerAuthStart: (provider, force) =>
    previewProvider(provider, () => demo.githubAuthStart(force)),
  trackerAuthStatus: (provider) => previewProvider(provider, () => demo.githubAuthStatus()),
  trackerAuthCancel: (provider, attemptId) =>
    previewProvider(provider, () => demo.githubAuthCancel(attemptId)),
  trackerAuthOpen: (provider) => previewProvider(provider, () => demo.githubAuthOpen()),
  trackerOwners: (provider) => previewProvider(provider, () => demo.githubOwners()),
  trackerProjects: (provider, owner) =>
    previewProvider(provider, () => demo.githubProjects(owner as import('./types').GitHubOwner)),
  trackerCreateProject: (provider, owner, title) =>
    previewProvider(provider, () =>
      demo.githubCreateProject(owner as import('./types').GitHubOwner, title),
    ),
  trackerLink: (id, provider, url) => previewProvider(provider, () => demo.githubLink(id, url)),
  trackerUnlink: async (id) => {
    if (!groups.some((g) => g.id === id)) throw new Error('Project not found');
    groups = groups.map((g) => {
      if (g.id !== id) return g;
      const { tracker: _tracker, github: _github, ...rest } = g;
      return rest;
    });
  },
  trackerBoard: (id) => demo.githubBoard(id),
  trackerProjectAction: async () => {
    throw new Error('Open the desktop app to manage GitHub projects.');
  },
  trackerContent: async (_group, item) => structuredClone(demoContentFor(item)),
  trackerContentChange: async (_group, item, revision, action) => {
    const content = demoContentFor(item);
    if (content.revision !== revision)
      throw new Error('The content changed. Reload before saving.');
    if (action.kind !== 'comment')
      throw new Error('Open the desktop app to make this change on GitHub.');
    if (!action.body.trim()) throw new Error('Enter a comment.');
    content.comments.push({
      id: crypto.randomUUID(),
      body: action.body,
      url: 'https://github.com/example/atlas-web/issues/12#issuecomment-preview',
      createdAt: new Date().toISOString(),
      author: { login: 'you' },
    });
    content.revision = crypto.randomUUID();
    return structuredClone(content);
  },
  trackerRelations: async () => {
    throw new Error('Issue relationships require the desktop app.');
  },
  trackerRelationChange: async () => {
    throw new Error('Issue relationships require the desktop app.');
  },
  trackerSavedView: async () => {
    throw new Error('Saved GitHub views require the desktop app.');
  },
  trackerResources: async () => {
    throw new Error('Open the desktop app to manage GitHub project resources.');
  },
  trackerResourceChange: async () => {
    throw new Error('Open the desktop app to manage GitHub project resources.');
  },
  trackerSettings: async () => {
    throw new Error('Open the desktop app to manage GitHub project settings.');
  },
  trackerSettingsUpdate: async () => {
    throw new Error('Open the desktop app to manage GitHub project settings.');
  },
  trackerPortfolio: async () => {
    throw new Error('Portfolio reads require connected GitHub projects in the desktop app.');
  },
  trackerDocsPlan: async () => {
    throw new Error('Issue publication requires the desktop app.');
  },
  trackerMutationHistory: async (_group, reviewedId) => {
    if (reviewedId) {
      const row = demoWrites.find((value) => value.id === reviewedId);
      if (!row || row.state !== 'unknown-outcome')
        throw new Error('This operation does not need reconciliation.');
      row.state = 'reviewed';
      row.updatedAt = Date.now();
    }
    return structuredClone(demoWrites);
  },
  trackerMutationRevert: async (_group, mutationId) => {
    const row = demoWrites.find((value) => value.id === mutationId);
    if (!row) throw new Error('This write is no longer in the history.');
    if (!canRevertMutation(row))
      throw new Error('Only confirmed field changes with a known earlier value can be reverted.');
    const { itemId, before, value } = row.detail!;
    const task = board.items.find((item) => item.id === itemId);
    const target = (before as { singleSelectOptionId: string }).singleSelectOptionId;
    const written = (value as { singleSelectOptionId: string }).singleSelectOptionId;
    if (task && task.statusId !== written)
      throw new Error('The field changed after this write. Change it on GitHub.');
    if (task) {
      task.statusId = target;
      task.status = board.statusField.options.find((option) => option.id === target)!.name;
    }
    const id = demoStatusWrite(itemId!, written, target, mutationId);
    row.revertedBy = id;
    return id;
  },
  trackerBatch: async () => {
    throw new Error('Batch editing requires the desktop app.');
  },
  trackerField: async () => {
    throw new Error('Connect GitHub in the desktop app to edit fields.');
  },
  trackerItemAction: async () => {
    throw new Error('Connect GitHub in the desktop app to change items.');
  },
  trackerStatus: (id, item, status) => demo.githubStatus(id, item, status),
  trackerDraft: (id, title, body) => demo.githubDraft(id, title, body),
  trackerAddIssue: (id, url) => demo.githubAddIssue(id, url),
  trackerConfigure: async (id, mapping, statusFieldId) => {
    const group = groups.find((g) => g.id === id);
    if (group?.github)
      group.tracker = {
        provider: 'github',
        project: group.github,
        statusMapping: mapping,
        statusFieldId,
      };
  },
  githubCliCheck: async () => ({ status: 'unavailable' }),
  agentInstallations: async () => [
    { agent: 'codex', status: 'unavailable' },
    { agent: 'claude', status: 'unavailable' },
  ],
  browserAction: nativeOnly,
  sessionAction: nativeOnly,
  remoteHosts: async () => [],
  remoteAdd: nativeOnly,
  remoteCheck: nativeOnly,
  remoteInstall: nativeOnly,
  remoteConnect: nativeOnly,
  remoteDisconnect: nativeOnly,
  remoteRemove: nativeOnly,
  remoteCall: nativeOnly as API['remoteCall'],
  directoryList: nativeOnly,
  remoteFolders: nativeOnly,
  remoteAddRepository: nativeOnly,
  ptyOpen: nativeOnly,
  ptyRead: nativeOnly,
  ptyWrite: nativeOnly,
  ptyResize: nativeOnly,
  ptyClose: nativeOnly,
  browserLayout: nativeOnly,
  browserNavigate: nativeOnly,
  browserState: nativeOnly,
  terminalStart: nativeOnly,
  terminalStatus: nativeOnly,
  terminalInput: nativeOnly,
  terminalStop: nativeOnly,
  repositoryDiff: nativeOnly,
  browserOpen: nativeOnly,
  browserSelect: nativeOnly,
  browserClose: nativeOnly,
  githubRepositories: async () => [
    {
      nameWithOwner: 'example/mobile-app',
      description: 'Mobile client',
      isPrivate: true,
      isArchived: false,
    },
    {
      nameWithOwner: 'example/docs',
      description: 'Documentation',
      isPrivate: false,
      isArchived: false,
    },
  ],
  cloneRepository: async (name, groupId) => {
    const id = crypto.randomUUID();
    projects.push({
      id,
      name: name.split('/')[1],
      path: '/Users/you/Developer/' + name.split('/')[1],
      notes: '',
      favorite: false,
      addedAt: now,
    });
    groups = groups.map((g) => (g.id === groupId ? { ...g, repoIds: [...g.repoIds, id] } : g));
    return true;
  },
  models: async (agent) =>
    agent === 'claude'
      ? [
          { id: 'sonnet', name: 'Sonnet' },
          { id: 'opus', name: 'Opus' },
          { id: 'haiku', name: 'Haiku' },
        ]
      : [],
  githubAuthStart: async () => ({ status: 'ready' }),
  githubAuthStatus: async () => ({ status: 'ready' }),
  githubAuthCancel: async () => ({ status: 'idle' }),
  githubAuthOpen: async () => {},
  githubOwners: async () => [{ id: 'example', login: 'example', kind: 'organization' }],
  githubProjects: async () => [structuredClone(board.project)],
  githubCreateProject: async (owner, title) => {
    board.project = {
      id: crypto.randomUUID(),
      title,
      owner: owner.login,
      number: 2,
      url: `https://github.com/${owner.kind === 'user' ? 'users' : 'orgs'}/${owner.login}/projects/2`,
    };
    board.items = [];
    return structuredClone(board.project);
  },
  githubLink: async (id, url) => {
    groups = groups.map((g) =>
      g.id === id
        ? {
            ...g,
            github: url ? structuredClone(board.project) : undefined,
            tracker: url
              ? { provider: 'github', project: structuredClone(board.project) }
              : undefined,
          }
        : g,
    );
  },
  githubBoard: async () => structuredClone(board),
  githubStatus: async (_id, item, option) => {
    const task = board.items.find((i) => i.id === item);
    if (task) {
      if (task.statusId !== option) demoStatusWrite(item, task.statusId, option);
      task.statusId = option;
      task.status = board.statusField.options.find((o) => o.id === option)!.name;
    }
  },
  githubDraft: async (_id, title, body) => {
    const id = crypto.randomUUID();
    board.items.push({
      id,
      title,
      body,
      repository: '',
      status: 'Todo',
      statusId: 'todo',
    });
    return id;
  },
  githubAddIssue: nativeOnly,

  createGroup: async (name, url, hostId, provider, rootPath, operationId, paths) => {
    const id = operationId || crypto.randomUUID();
    if (groups.some((group) => group.id === id)) return id;
    groups.push({
      id,
      name,
      rootPath: rootPath || '~/.kalkidan/projects/' + id,
      hostId,
      ...(url ? { github: { ...board.project, url } } : {}),
      repoIds: [],
    });
    if (paths?.length) await demo.addRepositories(id, paths);
    return id;
  },
  setGroupColor: async (id, color) => {
    groups = groups.map((g) => (g.id === id ? { ...g, color: color || undefined } : g));
  },
  updateGroup: async (id, name) => {
    groups = groups.map((g) => (g.id === id ? { ...g, name } : g));
  },
  removeGroup: async (id, withRepositories) => {
    const group = groups.find((g) => g.id === id);
    if (!group) throw new Error('Project not found');
    if (withRepositories) projects = projects.filter((p) => !group.repoIds.includes(p.id));
    groups = groups.filter((g) => g.id !== id);
  },
  moveRepo: async (id, groupId) => {
    groups = groups.map((g) => ({
      ...g,
      repoIds: [...g.repoIds.filter((r) => r !== id), ...(g.id === groupId ? [id] : [])],
    }));
  },
  chatCreate: async () => {
    throw new Error(previewAgentBlock);
  },
  transcript: async (agent, id) => ({
    messages: [
      {
        id: 'preview-user',
        role: 'user',
        text:
          sessions.find((s) => s.agent === agent && s.id === id)?.title || 'Continue this project',
      },
      {
        id: 'preview-assistant',
        role: 'assistant',
        text: 'This is a sample conversation. In the desktop app, your original messages appear here and you can continue with the same agent.',
      },
    ],
    truncated: false,
  }),
  chatStart: async () => {
    throw new Error(previewAgentBlock);
  },
  chatStatus: async () => {
    throw new Error('No active conversation in preview mode.');
  },
  chatStop: nativeOnly,
  chatApprove: nativeOnly,
  chatRespond: nativeOnly,
  dispatchReconcile: async () => {
    throw Error('Dispatch recovery requires the desktop app.');
  },
  dispatchPrepare: async (request) => {
    if (!request.tasks.length) throw new Error('Choose at least one task.');
    const plan: DispatchPlan = {
      ...structuredClone(request),
      state: 'review',
      rows: request.tasks.map(({ taskId, repositoryId }) => {
        const task = board.items.find((item) => item.id === taskId);
        const title = task?.title || 'Task';
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40);
        return {
          taskId,
          repositoryId,
          title,
          prompt:
            `Work on the task "${title}".\n\n${task?.body || ''}\n\n` +
            'Make the change in this branch copy, run the tests, and summarize what you changed.',
          revision: crypto.randomUUID(),
          operationId: crypto.randomUUID(),
          branch: `kalkidan/${slug || 'task'}`,
          state: 'queued' as const,
        };
      }),
    };
    demoDispatches.set(plan.id, { plan, startedAt: 0 });
    return structuredClone(plan);
  },
  dispatchStart: async (id) => {
    const entry = demoDispatch(id);
    if (entry.plan.state !== 'review') return structuredClone(entry.plan);
    entry.startedAt = Date.now();
    entry.plan.state = 'running';
    for (const row of entry.plan.rows) {
      row.state = 'running';
      row.checkoutId = 'demo-' + row.operationId.slice(0, 8);
      row.runId = 'demo-run-' + row.operationId.slice(0, 8);
    }
    return structuredClone(entry.plan);
  },
  dispatchStatus: async (id) => {
    const entry = demoDispatch(id);
    // Each task finishes a few seconds after the one before it.
    if (entry.plan.state === 'running') {
      const elapsed = Date.now() - entry.startedAt;
      entry.plan.rows.forEach((row, index) => {
        if (row.state === 'running' && elapsed > 4000 + index * 2500) {
          row.state = 'completed';
          row.message = 'The agent finished. Review the changes in the branch copy.';
        }
      });
      if (entry.plan.rows.every((row) => row.state !== 'running')) entry.plan.state = 'completed';
    }
    return structuredClone(entry.plan);
  },
  dispatchCancel: async (id) => {
    const entry = demoDispatch(id);
    if (entry.plan.state !== 'completed') {
      entry.plan.state = 'canceled';
      for (const row of entry.plan.rows)
        if (['queued', 'preparing', 'dispatching', 'running'].includes(row.state)) {
          row.state = 'canceled';
          row.message = 'Stopped.';
        }
    }
    return structuredClone(entry.plan);
  },
  taskWorktree: async () => {
    await nativeOnly();
    return null;
  },
  updateSession: async (agent, id, changes) => {
    const session = sessions.find((s) => s.agent === agent && s.id === id);
    if (session) session.organization = { ...session.organization, ...changes };
  },
  repositorySnapshot: async (id) => ({
    git: {
      branch: 'main',
      changes: 3,
      worktrees: [{ path: projects.find((p) => p.id === id)?.path || '', branch: 'main' }],
    },
    sessions: sessions.filter((s) => s.cwd === projects.find((p) => p.id === id)?.path),
    warnings: [],
  }),
  snapshot: async () => ({
    projects: [...projects],
    groups: structuredClone(groups),
    sessions,
    warnings: [],
    platform: 'preview',
  }),
  add: nativeOnly,
  historyPreview: async () => ({
    sessions: sessions.map((s) => ({ ...s, available: true, missingFolder: false })),
    warnings: [],
    sources: { codex: '~/.codex', claude: '~/.claude' },
  }),
  historyImport: async (request) => {
    let imported = 0;
    for (const selected of request.sessions) {
      const session = sessions.find((s) => s.id === selected.id && s.agent === selected.agent);
      if (session) {
        session.organization = {
          ...session.organization,
          ...(request.collection?.trim() ? { collection: request.collection.trim() } : {}),
        };
        imported++;
      }
    }
    return { imported, repositories: 0, skipped: [] };
  },
  discover: async () => {
    await nativeOnly();
    return { added: 0 };
  },
  chooseFolder: async () => '~/code/atlas',
  scanRepositories: async (path) => {
    const root = folderPath(path);
    return {
      root,
      rootIsRepository: false,
      repositories: scanNames.map(({ name, branch }) => ({
        path: `${root === '/' ? '' : root}/${name}`,
        name,
        branch,
        added: projects.some((p) => !p.hostId && p.path === `${root}/${name}`),
      })),
      truncated: false,
    };
  },
  addRepositories: async (groupId, paths) => {
    if (!groups.some((g) => g.id === groupId))
      throw new Error('Choose a project before adding repositories.');
    const ids: string[] = [];
    for (const path of new Set(paths.map(folderPath))) {
      if (projects.some((p) => !p.hostId && p.path === path)) continue;
      const id = crypto.randomUUID();
      projects.push({
        id,
        name: path.split('/').pop() || path,
        path,
        notes: '',
        favorite: false,
        addedAt: new Date().toISOString(),
      });
      ids.push(id);
    }
    groups = groups.map((g) => (g.id === groupId ? { ...g, repoIds: [...g.repoIds, ...ids] } : g));
    return { added: ids.length };
  },
  worktreePreview: async (id, branch) => {
    previewBranch(branch);
    const repo = projects.find((p) => p.id === id);
    if (!repo) throw new Error('Project not found');
    const group = groups.find((g) => g.repoIds.includes(id));
    if (!group) throw new Error('Assign this repository to a project before creating a worktree.');
    const root = group.rootPath || `~/.kalkidan/projects/${group.id}`;
    return {
      base: 'main',
      path: `${root}/worktrees/${repo.name}-${branch.replace(/[\\/]/g, '-')}`,
    };
  },
  gitSwitchNewBranch: async (_id, branch) => {
    previewBranch(branch);
  },
  workingFiles: async () => [
    { path: 'src/components/project-tree.tsx', status: 'modified' },
    { path: 'src/styles/projects.css', status: 'modified' },
    { path: 'docs/navigation.md', status: 'untracked' },
  ],
  update: async (id, changes) => {
    projects = projects.map((p) => (p.id === id ? { ...p, ...changes } : p));
  },
  remove: async (id) => {
    projects = projects.filter((p) => p.id !== id);
  },
  git: async (id) => ({
    branch: 'main',
    changes: id === '1' ? 3 : 0,
    worktrees: [{ path: projects.find((p) => p.id === id)!.path, branch: 'main' }],
  }),
  launch: nativeOnly,
  reveal: nativeOnly,
  worktree: async () => {
    await nativeOnly();
    return false;
  },
  worktreeRemove: async (id) => {
    if (!projects.some((p) => p.id === id)) throw new Error('Project not found');
    projects = projects.filter((p) => p.id !== id);
    groups = groups.map((g) => ({ ...g, repoIds: g.repoIds.filter((r) => r !== id) }));
  },
  workingStatus: async () => ({
    branch: 'main',
    changed: 2,
    untracked: 1,
    ahead: 0,
    published: true,
    defaultBranch: 'main',
  }),
  gitPublish: async () => {
    throw new Error('Open the desktop app to publish repository changes.');
  },
  gitPublishStatus: async () => null,
  gitCommit: async (_id, message, files) => {
    if (!message.trim()) throw new Error('Enter a commit message.');
    if (files && !files.length) throw new Error('Choose at least one file to commit.');
    return { commit: crypto.randomUUID().replaceAll('-', '').slice(0, 7) };
  },
  gitPullRequest: async (_id, title) => {
    if (!title.trim()) throw new Error('Enter a pull request title.');
    return { url: 'https://github.com/example/atlas-web/pull/42' };
  },
  onMenuCommand: () => () => {},
};
