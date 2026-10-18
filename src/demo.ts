import type { API, Project, Session, ProjectGroup } from './types';
const now = new Date().toISOString();
let projects: Project[] = [
  { id: '1', name: 'atlas-web', path: '/Users/you/Developer/atlas-web', favorite: true, notes: 'Customer-facing app. Keep shared implementation decisions in AGENTS.md and agent-specific guidance in CLAUDE.md.', addedAt: now },
  { id: '2', name: 'design-system', path: '/Users/you/Developer/design-system', favorite: true, notes: '', addedAt: now },
  { id: '3', name: 'api-service', path: '/Users/you/Developer/api-service', favorite: false, notes: '', addedAt: now }
];
let groups: ProjectGroup[] = [{ id: 'atlas', name: 'Atlas', repoIds: ['1', '2', '3'] }];
const sessions: Session[] = [{ id: 'demo-session', agent: 'codex', cwd: projects[0].path, updatedAt: now, title: 'Refine project and repository navigation' }, { id: 'demo-claude', agent: 'claude', cwd: projects[0].path, updatedAt: now, title: 'Review the authentication flow and add integration tests' }];
const board = { project: { id: 'demo-project', title: 'Atlas roadmap', url: 'https://github.com/orgs/example/projects/1', owner: 'example', number: 1 }, statusField: { id: 'status', options: [{ id: 'todo', name: 'Todo' }, { id: 'progress', name: 'In progress' }, { id: 'done', name: 'Done' }] }, items: [{ id: 'task-1', title: 'Build the project overview', body: 'Bring repositories, sessions, and planning into one project view.', repository: 'example/atlas-web', status: 'In progress', statusId: 'progress' }, { id: 'task-2', title: 'Review authentication', body: 'Review the sign-in flow and add integration tests.', repository: 'example/api-service', status: 'Todo', statusId: 'todo' }] };
const nativeOnly = async () => { throw new Error('Open the desktop app to use native folder and Terminal actions.'); };
export const demo: API = {
  browserAction: nativeOnly,
  sessionAction: nativeOnly, scheduledTasks: async () => [], scheduleTask: nativeOnly, scheduleRun: nativeOnly, scheduleCancel: nativeOnly,
  remoteHosts: async () => [], remoteAdd: nativeOnly, remoteCheck: nativeOnly, remoteInstall: nativeOnly, remoteConnect: nativeOnly, remoteDisconnect: nativeOnly, remoteCall: nativeOnly, remoteFolders: nativeOnly, remoteAddRepository: nativeOnly,
  ptyOpen: nativeOnly, ptyRead: nativeOnly, ptyWrite: nativeOnly, ptyResize: nativeOnly, ptyClose: nativeOnly,
  browserLayout: nativeOnly, browserNavigate: nativeOnly, browserState: nativeOnly,
  terminalStart: nativeOnly, terminalStatus: nativeOnly, terminalInput: nativeOnly, terminalStop: nativeOnly,
  repositoryDiff: nativeOnly, browserOpen: nativeOnly, browserSelect: nativeOnly, browserClose: nativeOnly,
  githubRepositories: async () => [{ nameWithOwner: 'example/mobile-app', description: 'Mobile client', isPrivate: true, isArchived: false }, { nameWithOwner: 'example/docs', description: 'Documentation', isPrivate: false, isArchived: false }],
  cloneRepository: async (name, groupId) => { const id = crypto.randomUUID(); projects.push({ id, name: name.split('/')[1], path: '/Users/you/Developer/' + name.split('/')[1], notes: '', favorite: false, addedAt: now }); groups = groups.map(g => g.id === groupId ? { ...g, repoIds: [...g.repoIds, id] } : g); return true; },
  models: async agent => agent === 'claude' ? [{ id: 'sonnet', name: 'Sonnet' }, { id: 'opus', name: 'Opus' }, { id: 'haiku', name: 'Haiku' }] : [],
  githubAuthStart: async () => ({ status: 'ready' }),
  githubAuthStatus: async () => ({ status: 'ready' }),
  githubAuthCancel: async () => ({ status: 'idle' }),
  githubAuthOpen: async () => {},
  githubOwners: async () => [{ id: 'example', login: 'example', kind: 'organization' }],
  githubProjects: async () => [structuredClone(board.project)],
  githubCreateProject: async (owner, title) => { board.project = { id: crypto.randomUUID(), title, owner: owner.login, number: 2, url: `https://github.com/${owner.kind === 'user' ? 'users' : 'orgs'}/${owner.login}/projects/2` }; board.items = []; return structuredClone(board.project); },
  githubLink: async (id, url) => { groups = groups.map(g => g.id === id ? { ...g, github: url ? board.project : undefined } : g); },
  githubBoard: async () => structuredClone(board),
  githubStatus: async (_id, item, option) => { const task = board.items.find(i => i.id === item); if (task) { task.statusId = option; task.status = board.statusField.options.find(o => o.id === option)!.name; } },
  githubDraft: async (_id, title, body) => { board.items.push({ id: crypto.randomUUID(), title, body, repository: '', status: 'Todo', statusId: 'todo' }); },
  githubAddIssue: nativeOnly,

  createGroup: async (name, url) => { if (!url) throw new Error('Choose a GitHub Project first.'); const id = crypto.randomUUID(); groups.push({ id, name, github: { ...board.project, url }, repoIds: [] }); return id; },
  updateGroup: async (id, name) => { groups = groups.map(g => g.id === id ? { ...g, name } : g); },
  removeGroup: async id => { groups = groups.filter(g => g.id !== id); },
  moveRepo: async (id, groupId) => { groups = groups.map(g => ({ ...g, repoIds: [...g.repoIds.filter(r => r !== id), ...(g.id === groupId ? [id] : [])] })); },
  chatCreate: async () => { throw new Error('Open the desktop app to send messages to your installed agent.'); },
  transcript: async (agent, id) => ({ messages: [{ id: 'preview-user', role: 'user', text: sessions.find(s => s.agent === agent && s.id === id)?.title || 'Continue this project' }, { id: 'preview-assistant', role: 'assistant', text: 'This is a sample conversation. In the desktop app, your original messages appear here and you can continue with the same agent.' }], truncated: false }),
  chatStart: async () => { throw new Error('Open the desktop app to send messages to your installed agent.'); },
  chatStatus: async () => { throw new Error('No active conversation in preview mode.'); },
  chatStop: nativeOnly, chatApprove: nativeOnly, taskWorktree: async () => { await nativeOnly(); return null; },
  updateSession: async (agent, id, changes) => { const session = sessions.find(s => s.agent === agent && s.id === id); if (session) session.organization = { ...session.organization, ...changes }; },
  snapshot: async () => ({ projects: [...projects], groups: structuredClone(groups), sessions, warnings: [], platform: 'preview' }),
  add: nativeOnly, discover: async () => { await nativeOnly(); return { added: 0 }; },
  update: async (id, changes) => { projects = projects.map(p => p.id === id ? { ...p, ...changes } : p); },
  remove: async id => { projects = projects.filter(p => p.id !== id); },
  git: async id => ({ branch: 'main', changes: id === '1' ? 3 : 0, worktrees: [{ path: projects.find(p => p.id === id)!.path, branch: 'main' }] }),
  launch: nativeOnly, reveal: nativeOnly, worktree: async () => { await nativeOnly(); return false; }
};
