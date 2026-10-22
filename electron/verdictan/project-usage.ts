import type { ManagedHistoryPage, ManagedHistoryTarget } from '../../src/domain/managed-history';
import {
  projectUsageLimits,
  type ProjectUsage,
  type ProjectUsageBilling,
  type ProjectUsageChat,
  type ProjectUsageChatRef,
} from '../../src/domain/project-usage';
import { DesktopProtocolError } from './protocol';

export interface UsageBinding {
  billing: ProjectUsageBilling;
  /** The folder of the chat, on the computer that runs the chat. */
  cwd: string;
  /** The Verdictan conversation. Two chats with the same conversation count one time only. */
  conversationId?: string;
}
/** The signed-in Verdictan account. `key` identifies the account for the cache. */
export interface UsageAccount {
  key: string;
  organizationId: string;
  userId: string;
}
export interface ProjectUsageSource {
  /**
   * The current account. The reader calls it once for each read. It fails when the account is
   * not ready, and then the read fails.
   */
  account: () => Promise<UsageAccount>;
  /** One page of the Verdictan history of a chat. */
  history: (target: ManagedHistoryTarget) => Promise<ManagedHistoryPage>;
  /** The binding of a chat for this account, or null. */
  binding: (
    agent: 'codex' | 'claude',
    sessionId: string,
    account: UsageAccount,
  ) => Promise<UsageBinding | null>;
  /**
   * True when the folder is in a code folder of the project. For a chat on an SSH host,
   * `hostId` is the host, and the folder is a folder on that host.
   */
  inProject: (groupId: string, cwd: string, hostId?: string) => Promise<boolean>;
  /** The name of an SSH host, for the label of its chats. */
  hostName?: (hostId: string) => string | undefined;
  now?: () => string;
  /** Milliseconds since the epoch, for the cache. */
  clock?: () => number;
}
export interface ProjectUsageOptions {
  /** Read each chat again and ignore the cache. */
  fresh?: boolean;
}

/** The number of chats that the reader reads at the same time. */
export const usageConcurrency = 4;
/** A chat result stays in the cache for this time. */
export const usageCacheMs = 60_000;

type ChatResult =
  { kind: 'chat'; usage: ProjectUsageChat; conversationId?: string } | { kind: 'unmanaged' };

/** The SSH host of a chat. A remote session ID has the form `<hostId>::<provider ID>`. */
export function chatHost(sessionId: string) {
  const index = sessionId.indexOf('::');
  return index > 0 ? sessionId.slice(0, index) : undefined;
}

function validRef(value: unknown): value is { agent: 'codex' | 'claude'; sessionId: string } {
  const ref = value as ProjectUsageChatRef;
  return (
    !!ref &&
    typeof ref === 'object' &&
    (ref.agent === 'codex' || ref.agent === 'claude') &&
    typeof ref.sessionId === 'string' &&
    ref.sessionId.length > 0 &&
    ref.sessionId.length <= 512
  );
}

/**
 * Reads the Verdictan history of the chats of a project. Only chats with a binding for the
 * current account and a folder in the project count. A chat on an SSH host counts when its
 * folder is in a code folder of the project on that host. Two chats with the same Verdictan
 * conversation count one time only: the first chat in the request keeps the history. When no
 * chat history can be read, the first error goes to the caller, so that the page can tell why
 * the history is unavailable.
 *
 * The reader reads up to `usageConcurrency` chats at the same time. It keeps the result of
 * each chat for `usageCacheMs`. The cache is for one account only: a different account clears
 * it. A chat that fails does not go into the cache.
 */
export class ProjectUsageReader {
  private cache = new Map<string, { at: number; result: ChatResult }>();
  private cacheAccount = '';
  constructor(private source: ProjectUsageSource) {}
  async read(
    groupId: string,
    chats: ProjectUsageChatRef[],
    options: ProjectUsageOptions = {},
  ): Promise<ProjectUsage> {
    if (
      typeof groupId !== 'string' ||
      !groupId ||
      !Array.isArray(chats) ||
      chats.length > 1000 ||
      !chats.every(validRef) ||
      typeof options !== 'object' ||
      options === null
    )
      throw new DesktopProtocolError('desktop.invalid_request');
    const seen = new Set<string>();
    const unique = chats.filter((chat) => {
      const key = `${chat.agent}:${chat.sessionId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const read = unique.slice(0, projectUsageLimits.chats);
    const observedAt = (this.source.now ?? (() => new Date().toISOString()))();
    const account = await this.source.account();
    if (!account.key || account.key !== this.cacheAccount) {
      this.cache.clear();
      this.cacheAccount = account.key;
    }
    const clock = this.source.clock ?? Date.now;
    const fresh = options.fresh === true;
    const results: (ChatResult | { kind: 'failed'; error: unknown })[] = [];
    let next = 0;
    let stopped = false;
    // Each worker takes the next chat. An error from the binding or the folder check stops the
    // read, as before: then the account or the project is not ready.
    const worker = async () => {
      while (!stopped && next < read.length) {
        const index = next++;
        const chat = read[index];
        const key = JSON.stringify([groupId, chat.agent, chat.sessionId]);
        const cached = this.cache.get(key);
        if (!fresh && account.key && cached && clock() - cached.at < usageCacheMs) {
          results[index] = cached.result;
          continue;
        }
        const result = await this.readChat(groupId, chat, account).catch((error: unknown) => {
          stopped = true;
          throw error;
        });
        if (result.kind === 'failed') this.cache.delete(key);
        else if (account.key && this.cacheAccount === account.key)
          this.cache.set(key, { at: clock(), result });
        results[index] = result;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(usageConcurrency, read.length) }, () => worker()),
    );
    const result: ProjectUsage = {
      chats: [],
      unmanaged: 0,
      failed: 0,
      skipped: unique.length - read.length,
      observedAt,
    };
    let firstError: unknown;
    const conversations = new Set<string>();
    for (const item of results) {
      if (item.kind === 'chat') {
        if (item.conversationId) {
          if (conversations.has(item.conversationId)) continue;
          conversations.add(item.conversationId);
        }
        result.chats.push(structuredClone(item.usage));
      } else if (item.kind === 'unmanaged') result.unmanaged++;
      else {
        firstError ??= item.error;
        result.failed++;
      }
    }
    if (result.failed > 0 && result.chats.length === 0) throw firstError;
    return result;
  }
  private async readChat(
    groupId: string,
    chat: { agent: 'codex' | 'claude'; sessionId: string },
    account: UsageAccount,
  ): Promise<ChatResult | { kind: 'failed'; error: unknown }> {
    const binding = await this.source.binding(chat.agent, chat.sessionId, account);
    const hostId = chatHost(chat.sessionId);
    if (!binding || !(await this.source.inProject(groupId, binding.cwd, hostId)))
      return { kind: 'unmanaged' };
    const hostName = hostId ? this.source.hostName?.(hostId) : undefined;
    const usage: ProjectUsageChat = {
      agent: chat.agent,
      sessionId: chat.sessionId,
      billing: binding.billing,
      ...(hostId ? { hostId } : {}),
      ...(hostName ? { hostName } : {}),
      entries: [],
      complete: false,
    };
    try {
      let cursor: string | undefined;
      for (let page = 0; page < projectUsageLimits.pages; page++) {
        const next = await this.source.history({
          kind: 'conversation',
          agent: chat.agent,
          sessionId: chat.sessionId,
          ...(cursor ? { cursor } : {}),
        });
        usage.entries.push(...next.entries);
        if (!next.cursor) {
          usage.complete = true;
          break;
        }
        cursor = next.cursor;
      }
      return {
        kind: 'chat',
        usage,
        ...(binding.conversationId ? { conversationId: binding.conversationId } : {}),
      };
    } catch (error) {
      return { kind: 'failed', error };
    }
  }
}
