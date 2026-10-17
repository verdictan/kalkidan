import type { API, Project, Session } from './types';
const now = new Date().toISOString();
let projects: Project[] = [
  { id: '1', name: 'atlas-web', path: '/Users/you/Developer/atlas-web', favorite: true, notes: 'Customer-facing app. Keep shared implementation decisions in AGENTS.md and agent-specific guidance in CLAUDE.md.', addedAt: now },
  { id: '2', name: 'design-system', path: '/Users/you/Developer/design-system', favorite: true, notes: '', addedAt: now },
  { id: '3', name: 'api-service', path: '/Users/you/Developer/api-service', favorite: false, notes: '', addedAt: now }
];
const sessions: Session[] = [{ id: 'demo-session', agent: 'codex', cwd: projects[0].path, updatedAt: now, title: 'Refine the project navigation and workspace switcher' }, { id: 'demo-claude', agent: 'claude', cwd: projects[0].path, updatedAt: now, title: 'Review the authentication flow and add integration tests' }];
const nativeOnly = async () => { throw new Error('Open the desktop app to use native folder and Terminal actions.'); };
export const demo: API = {
  snapshot: async () => ({ projects: [...projects], sessions, warnings: [], platform: 'preview' }),
  add: nativeOnly, discover: async () => { await nativeOnly(); return { added: 0 }; },
  update: async (id, changes) => { projects = projects.map(p => p.id === id ? { ...p, ...changes } : p); },
  remove: async id => { projects = projects.filter(p => p.id !== id); },
  git: async id => ({ branch: 'main', changes: id === '1' ? 3 : 0, worktrees: [{ path: projects.find(p => p.id === id)!.path, branch: 'main' }] }),
  launch: nativeOnly, reveal: nativeOnly, worktree: async () => { await nativeOnly(); return false; }
};
