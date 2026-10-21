import {
  historyEntries,
  type ManagedHistoryPage,
  type ManagedHistoryTarget,
} from '../../src/domain/managed-history';
import type { ProjectServiceResult } from '../../src/domain/project-services';
import { parseCapabilities } from './account';
import { DesktopProtocolError, type DesktopClient, type HistoryScope } from './protocol';

/** The correlation keys of one history scope. The backend resolves them, never the renderer. */
export type HistoryKeys = Omit<HistoryScope, 'organization_id'>;
export interface HistorySource {
  client: DesktopClient;
  accountKey: string;
  organizationId: string;
  actorId: string;
  keys: HistoryKeys;
}
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const keyNames = ['project_id', 'conversation_id', 'task_id', 'run_id'] as const;
const pageLimit = 25;
const validTime = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const validCursor = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[!-~]+$/.test(value);

function validateTarget(target: ManagedHistoryTarget) {
  const text = (value: unknown) =>
    typeof value === 'string' && value.length > 0 && value.length <= 512;
  if (
    !target ||
    typeof target !== 'object' ||
    (target.cursor !== undefined && !validCursor(target.cursor)) ||
    (target.kind === 'task'
      ? !text(target.groupId) || !text(target.taskId)
      : target.kind !== 'conversation' || !text(target.agent) || !text(target.sessionId))
  )
    throw new DesktopProtocolError('desktop.invalid_request');
}

/**
 * Reads the Verdictan history of a task or a chat with `history.list`. When the runtime does not
 * advertise `history.list`, a task uses the earlier `task.history` for one release. A chat then
 * has no history. Each read uses the current ledger: load again without a cursor to see late
 * settlement corrections.
 */
export class ManagedHistory {
  constructor(
    private resolve: (target: ManagedHistoryTarget) => Promise<HistorySource>,
    private legacy?: (
      groupId: string,
      fields: { task_id: string; cursor?: string },
    ) => Promise<ProjectServiceResult>,
  ) {}
  async list(target: ManagedHistoryTarget): Promise<ManagedHistoryPage> {
    validateTarget(target);
    const source = await this.resolve(target);
    const { capabilities } = parseCapabilities((await source.client.request('capabilities')).data);
    if (capabilities.includes('history.list')) return this.read(target, source);
    if (target.kind === 'task' && this.legacy && capabilities.includes('task.history')) {
      const result = await this.legacy(target.groupId, {
        task_id: target.taskId,
        ...(target.cursor ? { cursor: target.cursor } : {}),
      });
      const cursor = result.next_cursor ?? result.cursor;
      if (!Array.isArray(result.items) || result.items.length > 100)
        throw new DesktopProtocolError('desktop.history_invalid');
      return {
        entries: historyEntries(result.items),
        cursor: validCursor(cursor) ? cursor : null,
        asOf: null,
        observedAt: result.observed_at,
        source: 'task-history',
      };
    }
    throw new DesktopProtocolError('desktop.operation_unsupported');
  }
  private async read(target: ManagedHistoryTarget, source: HistorySource) {
    const scope: HistoryScope = { organization_id: source.organizationId };
    for (const name of keyNames) {
      const value = source.keys[name];
      if (value === undefined) continue;
      if (!keyPattern.test(value)) throw new DesktopProtocolError('desktop.invalid_correlation');
      scope[name] = value;
    }
    if (Object.keys(scope).length < 2) throw new DesktopProtocolError('desktop.invalid_request');
    const data = (
      await source.client.request('history.list', {
        history_scope: scope,
        limit: pageLimit,
        ...(target.cursor ? { cursor: target.cursor } : {}),
      })
    ).data;
    const echo = data.history_scope as Record<string, unknown> | undefined;
    const items = data.items;
    if (
      data.actor_id !== source.actorId ||
      !echo ||
      typeof echo !== 'object' ||
      Object.keys(echo).length !== Object.keys(scope).length ||
      Object.entries(scope).some(([key, value]) => echo[key] !== value) ||
      !validTime(data.observed_at) ||
      (data.as_of != null && !validTime(data.as_of)) ||
      !Array.isArray(items) ||
      items.length > pageLimit ||
      (data.next_cursor !== null && !validCursor(data.next_cursor)) ||
      data.replay_executes_requests !== false ||
      // Each request belongs to this organization and to every key of the scope.
      items.some((item) => {
        const row = item as Record<string, unknown> | null;
        return (
          !row ||
          typeof row !== 'object' ||
          row.organization_id !== source.organizationId ||
          keyNames.some((name) => scope[name] !== undefined && row[name] !== scope[name])
        );
      })
    )
      throw new DesktopProtocolError('desktop.history_invalid');
    // The account can change while the request runs. Do not show another account's history.
    const current = await this.resolve(target);
    if (
      current.accountKey !== source.accountKey ||
      current.organizationId !== source.organizationId ||
      current.actorId !== source.actorId
    )
      throw new DesktopProtocolError('desktop.identity_mismatch');
    return {
      entries: historyEntries(items),
      cursor: (data.next_cursor as string | null) ?? null,
      asOf: (data.as_of as string | null | undefined) ?? null,
      observedAt: data.observed_at as string,
      source: 'history',
    } satisfies ManagedHistoryPage;
  }
}
