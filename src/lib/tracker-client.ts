import type { API, GitHubOwner, Session, TrackerOwner } from '../types';
import { githubDescriptor } from '../domain/tracker';
/** Compatibility boundary for preview fixtures and older desktop bridges only. */
export function trackerClient(api: API, provider = 'github') {
  function legacy<T>(fn: () => T): T {
    if (provider !== 'github')
      throw new Error(`Tracker ${provider} requires the current desktop app.`);
    return fn();
  }
  return {
    providers: () =>
      api.trackerProviders ? api.trackerProviders() : Promise.resolve([githubDescriptor]),
    authorize: (force?: boolean) =>
      api.trackerAuthStart
        ? api.trackerAuthStart(provider, force)
        : legacy(() => api.githubAuthStart(force)),
    authStatus: () =>
      api.trackerAuthStatus
        ? api.trackerAuthStatus(provider)
        : legacy(() => api.githubAuthStatus()),
    cancelAuth: (attemptId: string) =>
      api.trackerAuthCancel
        ? api.trackerAuthCancel(provider, attemptId)
        : legacy(() => api.githubAuthCancel(attemptId)),
    openAuth: () =>
      api.trackerAuthOpen ? api.trackerAuthOpen(provider) : legacy(() => api.githubAuthOpen()),
    owners: () =>
      api.trackerOwners ? api.trackerOwners(provider) : legacy(() => api.githubOwners()),
    projects: (owner: TrackerOwner) =>
      api.trackerProjects
        ? api.trackerProjects(provider, owner)
        : legacy(() => api.githubProjects(owner as GitHubOwner)),
    createProject: (owner: TrackerOwner, title: string) =>
      api.trackerCreateProject
        ? api.trackerCreateProject(provider, owner, title)
        : legacy(() => api.githubCreateProject(owner as GitHubOwner, title)),
    link: (id: string, reference: string) =>
      api.trackerLink
        ? api.trackerLink(id, provider, reference)
        : legacy(() => api.githubLink(id, reference)),
    board: (id: string, force = false) =>
      api.trackerBoard ? api.trackerBoard(id, force) : legacy(() => api.githubBoard(id)),
    status: (id: string, item: string, status: string) =>
      api.trackerStatus
        ? api.trackerStatus(id, item, status)
        : legacy(() => api.githubStatus(id, item, status)),
    draft: (id: string, title: string, body: string) =>
      api.trackerDraft
        ? api.trackerDraft(id, title, body)
        : legacy(() => api.githubDraft(id, title, body)),
    importItem: (id: string, url: string) =>
      api.trackerAddIssue
        ? api.trackerAddIssue(id, url)
        : legacy(() => api.githubAddIssue(id, url)),
  };
}

/** An issue that was a draft a short time ago, and the board column it had. */
export interface DraftRevertTarget {
  /** The board item of the issue. */
  itemId: string;
  /** The title and description to use when GitHub does not give them. */
  title: string;
  body: string;
  /** The status option of the new draft: the column of the issue. */
  statusId?: string;
}
export type DraftRevertResult =
  | { itemId: string; draftId: string; error?: undefined }
  | { itemId: string; draftId?: undefined; error: string };
type DraftRevertAPI = Pick<
  API,
  'trackerContent' | 'trackerContentChange' | 'trackerDraft' | 'trackerStatus' | 'trackerItemAction'
>;

/**
 * Changes new issues back to drafts. For each issue: adds a draft with the same title and
 * description in the same column, closes the issue as not planned, then removes the issue from
 * the board. Each step is a usual GitHub write, so the write history records it. When the issue
 * does not close, the new draft is removed again and the issue stays. One failure does not stop
 * the other issues.
 */
export async function revertIssuesToDrafts(
  api: DraftRevertAPI,
  groupId: string,
  targets: DraftRevertTarget[],
): Promise<DraftRevertResult[]> {
  const results: DraftRevertResult[] = [];
  for (const target of targets) {
    try {
      const content = await api.trackerContent(groupId, target.itemId);
      if (content.kind !== 'Issue') throw new Error('This task is not an issue now.');
      const title = (content.title || target.title).trim().slice(0, 256);
      const body = (content.body ?? target.body).slice(0, 20000);
      const draftId = await api.trackerDraft(groupId, title, body);
      if (typeof draftId !== 'string' || !draftId)
        throw new Error('GitHub did not return the new draft.');
      if (target.statusId)
        // The draft is on the board now. A failed column change only puts it in another column.
        await api.trackerStatus(groupId, draftId, target.statusId).catch(() => undefined);
      if (content.state === 'OPEN')
        try {
          await api.trackerContentChange(groupId, target.itemId, content.revision, {
            kind: 'close',
            reason: 'not-planned',
          });
        } catch (error) {
          await api.trackerItemAction(groupId, draftId, { kind: 'remove' }).catch(() => undefined);
          throw error;
        }
      await api.trackerItemAction(groupId, target.itemId, { kind: 'remove' });
      results.push({ itemId: target.itemId, draftId });
    } catch (error) {
      results.push({
        itemId: target.itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/**
 * Links the saved chats of each old task to its new draft. A chat that is not saved yet keeps
 * its link. A failed change keeps the old link: the chat continues in all cases.
 */
export async function relinkTaskChats(
  api: Pick<API, 'updateSession'>,
  sessions: Session[],
  results: DraftRevertResult[],
) {
  const moved = new Map(
    results.flatMap((result) => (result.draftId ? [[result.itemId, result.draftId]] : [])),
  );
  await Promise.all(
    sessions.flatMap((session) => {
      const draftId = moved.get(session.organization?.taskId || '');
      if (!draftId || session.id.startsWith('draft-')) return [];
      return [api.updateSession(session.agent, session.id, { taskId: draftId }).catch(() => {})];
    }),
  );
}
