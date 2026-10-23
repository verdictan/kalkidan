import { useEffect, useMemo } from 'react';
import {
  assignIdentityColors,
  fromLegacyProjectColor,
  publishIdentityColors,
  type IdentityColor,
  type IdentityKind,
} from '../domain/identity';
import { useIdentityOverrides } from './use-identity';
import { sessionRepo } from '../lib/session-repository';
import type { Project, ProjectGroup, Session } from '../types';
import type { SubagentSession } from '../domain/desktop';

/** A child run of a session, as the snapshot gives it. */
export type Subagent = SubagentSession;
/** The child runs of a session, oldest first. Older snapshots have none. */
export const subagentsOf = (session: Session): Subagent[] => session.subagents || [];

/** The identity colors of every item that the sidebar, search and the pages show. */
export interface WorkspaceIdentity {
  project(group: Pick<ProjectGroup, 'id'>): IdentityColor;
  repo(repo: Pick<Project, 'id'>): IdentityColor;
  session(session: Pick<Session, 'agent' | 'id'>): IdentityColor;
  subagent(session: Pick<Session, 'agent' | 'id'>, subagentId: string): IdentityColor;
}
const sessionKey = (session: Pick<Session, 'agent' | 'id'>) => session.id;
const parentKey = '\u0000parent';
/**
 * Colors for one group of siblings. The parent color is taken first, so that no child has the
 * color of its parent while a free color is left.
 */
function siblings(
  kind: IdentityKind,
  items: { key: string; name: string; color?: IdentityColor | null }[],
  parent: IdentityColor | undefined,
) {
  // The stored choices of the user win. assignIdentityColors reads them.
  const list = parent ? [{ key: parentKey, name: '', color: parent }, ...items] : items;
  return assignIdentityColors(kind, list);
}

/**
 * The identity colors of the projects, code folders, chats and subagents. A color is automatic
 * (from the name, never the color of a sibling or of the parent) unless the user chose one.
 * Projects and code folders keep their color by name; chats and subagents by their ID.
 */
export function useWorkspaceIdentity(
  groups: readonly ProjectGroup[],
  repos: readonly Project[],
  sessions: readonly Session[],
): WorkspaceIdentity {
  // A new choice in any window renders again.
  const overrides = useIdentityOverrides();
  const result = useMemo(() => {
    const projectByName = siblings(
      'project',
      groups.map((group) => ({
        key: group.name,
        name: group.name,
        color: fromLegacyProjectColor(group.color),
      })),
      undefined,
    );
    const projectColor = new Map(
      groups.map((group) => [group.id, projectByName.get(group.name) || 'slate'] as const),
    );
    const repoColor = new Map<string, IdentityColor>();
    for (const group of groups) {
      const members = repos.filter((repo) => group.repoIds.includes(repo.id));
      const byName = siblings(
        'repo',
        members.map((repo) => ({ key: repo.name, name: repo.name })),
        projectColor.get(group.id),
      );
      for (const repo of members) repoColor.set(repo.id, byName.get(repo.name) || 'slate');
    }
    const byRepo = new Map<string, Session[]>();
    for (const session of sessions) {
      const repo = sessionRepo(session, repos as Project[]);
      const key = repo?.id || '';
      byRepo.set(key, [...(byRepo.get(key) || []), session]);
    }
    const sessionColor = new Map<string, IdentityColor>();
    const subagentColor = new Map<string, IdentityColor>();
    for (const [repoId, list] of byRepo) {
      const ordered = [...list].sort((a, b) => a.id.localeCompare(b.id));
      const colors = siblings(
        'session',
        ordered.map((session) => ({
          key: sessionKey(session),
          name: session.organization?.title || session.title || session.id,
        })),
        repoColor.get(repoId),
      );
      for (const session of ordered) {
        const color = colors.get(sessionKey(session)) || 'slate';
        sessionColor.set(session.agent + ':' + session.id, color);
        const children = siblings(
          'subagent',
          subagentsOf(session).map((child) => ({ key: child.id, name: child.title })),
          color,
        );
        for (const child of subagentsOf(session))
          subagentColor.set(
            session.agent + ':' + session.id + ':' + child.id,
            children.get(child.id) || 'slate',
          );
      }
    }
    const published = {
      project: new Map(groups.map((g) => [g.name, projectColor.get(g.id) || 'slate'] as const)),
      repo: new Map(repos.map((r) => [r.name, repoColor.get(r.id) || 'slate'] as const)),
      session: new Map(
        sessions.map((x) => [x.id, sessionColor.get(x.agent + ':' + x.id) || 'slate'] as const),
      ),
      subagent: new Map(
        sessions.flatMap((x) =>
          subagentsOf(x).map(
            (c) => [c.id, subagentColor.get(x.agent + ':' + x.id + ':' + c.id) || 'slate'] as const,
          ),
        ),
      ),
    };
    const api: WorkspaceIdentity = {
      project: (group) => projectColor.get(group.id) || 'slate',
      repo: (repo) => repoColor.get(repo.id) || 'slate',
      session: (session) => sessionColor.get(session.agent + ':' + session.id) || 'slate',
      subagent: (session, id) =>
        subagentColor.get(session.agent + ':' + session.id + ':' + id) || 'slate',
    };
    return { api, published };
  }, [overrides, groups, repos, sessions]);
  // Other parts (the chat crumb, the editor) read the same colors through identity.ts.
  useEffect(() => {
    for (const kind of ['project', 'repo', 'session', 'subagent'] as const)
      publishIdentityColors(kind, result.published[kind]);
  }, [result]);
  return result.api;
}
