import type { ProjectDoc } from './domain/docs';
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
export const demo: API = {
  taskUsageHistory: async () => [],
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
    },
    helpers: [],
  }),
  runtimeUpdateStatus: async (hostId) => ({
    hostId: hostId || 'local',
    component: 'verdictan',
    discovery: 'unknown',
    stale: true,
    history: [],
    error: 'Runtime installation requires the desktop application.',
  }),
  runtimeUpdateCheck: async (hostId) => demo.runtimeUpdateStatus(hostId),
  runtimeUpdateInstall: async () => {
    throw new Error('Runtime installation requires the desktop application.');
  },
  runtimeUpdateCancel: async (hostId) => demo.runtimeUpdateStatus(hostId),
  memoryList: async () => ({ pages: [], limited: false }),
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
  trackerBoard: (id) => demo.githubBoard(id),
  trackerProjectAction: async () => {
    throw new Error('Open the desktop app to manage GitHub projects.');
  },
  trackerContent: async () => {
    throw new Error('Issue editing requires the desktop app.');
  },
  trackerContentChange: async () => {
    throw new Error('Issue editing requires the desktop app.');
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
  trackerMutationHistory: async () => [],
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
  dispatchPrepare: async () => {
    throw new Error('Automatic dispatch requires the desktop app.');
  },
  dispatchStart: async () => {
    throw new Error('Automatic dispatch requires the desktop app.');
  },
  dispatchStatus: async () => {
    throw new Error('Automatic dispatch requires the desktop app.');
  },
  dispatchCancel: async () => {
    throw new Error('Automatic dispatch requires the desktop app.');
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
