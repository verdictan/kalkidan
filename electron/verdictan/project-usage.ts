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
  cwd: string;
}
export interface ProjectUsageSource {
  /** One page of the Verdictan history of a chat. */
  history: (target: ManagedHistoryTarget) => Promise<ManagedHistoryPage>;
  /** The binding of a chat for the current account, or null. */
  binding: (agent: 'codex' | 'claude', sessionId: string) => Promise<UsageBinding | null>;
  /** True when the folder is in a local code folder of the project. */
  inProject: (groupId: string, cwd: string) => Promise<boolean>;
  now?: () => string;
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
 * current account and a folder in the project count. When no chat history can be read, the
 * first error goes to the caller, so that the page can tell why the history is unavailable.
 */
export class ProjectUsageReader {
  constructor(private source: ProjectUsageSource) {}
  async read(groupId: string, chats: ProjectUsageChatRef[]): Promise<ProjectUsage> {
    if (
      typeof groupId !== 'string' ||
      !groupId ||
      !Array.isArray(chats) ||
      chats.length > 1000 ||
      !chats.every(validRef)
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
    const result: ProjectUsage = {
      chats: [],
      unmanaged: 0,
      failed: 0,
      skipped: unique.length - read.length,
      observedAt: (this.source.now ?? (() => new Date().toISOString()))(),
    };
    let firstError: unknown;
    for (const chat of read) {
      const binding = await this.source.binding(chat.agent, chat.sessionId);
      if (!binding || !(await this.source.inProject(groupId, binding.cwd))) {
        result.unmanaged++;
        continue;
      }
      const usage: ProjectUsageChat = {
        agent: chat.agent,
        sessionId: chat.sessionId,
        billing: binding.billing,
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
        result.chats.push(usage);
      } catch (error) {
        firstError ??= error;
        result.failed++;
      }
    }
    if (result.failed > 0 && result.chats.length === 0) throw firstError;
    return result;
  }
}
