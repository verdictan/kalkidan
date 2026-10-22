import { readFile } from 'node:fs/promises';
import { writeJSON } from './storage/atomic-json';
import { isAgent } from '../src/config/agents';
import { addPolicyRecords, chatPolicyLimit, type PolicyRecord } from '../src/domain/policy-result';
import { finishedChatId, type FinishedChatRun } from './chat-outcomes';

/** The store keeps the policy results of this many chats. It removes the oldest chats first. */
export const policyResultChatLimit = 2000;
/** Each chat keeps this many policy results. It removes the oldest results first. */
export const policyResultsPerChat = chatPolicyLimit;
const chatId = /^(?:[a-zA-Z0-9_-]{1,160}::)?[a-zA-Z0-9_-]{1,160}$/;

interface Entry {
  agent: string;
  id: string;
  results: PolicyRecord[];
}

/**
 * The policy results of each chat, in `policy-results.json` in the data root. Each result has
 * only the gateway fields that the user saw: the decision, reason, reason code, policy version,
 * request ID, region and time. It never has the prompt, the answer, or the review state.
 */
export class PolicyResults {
  private entries = new Map<string, Entry>();
  private writes = Promise.resolve();
  constructor(
    private file: string,
    private limit = policyResultChatLimit,
  ) {}
  private static key(agent: string, id: string) {
    return `${agent}:${id}`;
  }
  /** Reads the file. A damaged file or entry is ignored: the results are only chat history. */
  async load() {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return;
      throw error;
    }
    const rows =
      data && typeof data === 'object' && Array.isArray((data as { chats?: unknown }).chats)
        ? (data as { chats: unknown[] }).chats
        : [];
    const next = new Map<string, Entry>();
    for (const row of rows) {
      const input = row as Partial<Entry> | null;
      if (!input || !isAgent(input.agent) || typeof input.id !== 'string' || !chatId.test(input.id))
        continue;
      const results = addPolicyRecords(
        next.get(PolicyResults.key(input.agent, input.id))?.results,
        Array.isArray(input.results) ? input.results : [],
        policyResultsPerChat,
      );
      if (results.length)
        next.set(PolicyResults.key(input.agent, input.id), {
          agent: input.agent,
          id: input.id,
          results,
        });
    }
    this.entries = this.bounded(next);
  }
  private bounded(entries: Map<string, Entry>) {
    if (entries.size <= this.limit) return entries;
    const latest = (entry: Entry) => entry.results.at(-1)?.at || '';
    return new Map(
      [...entries].sort(([, a], [, b]) => latest(b).localeCompare(latest(a))).slice(0, this.limit),
    );
  }
  /** The saved policy results of a chat, oldest first. */
  list(agent: unknown, id: unknown): PolicyRecord[] {
    if (!isAgent(agent) || typeof id !== 'string' || !chatId.test(id)) return [];
    return structuredClone(this.entries.get(PolicyResults.key(agent, id))?.results || []);
  }
  /**
   * Adds policy results to a chat. Records that are not valid are dropped. The memory changes at
   * once. The file write follows in order.
   */
  record(agent: string, id: string, added: readonly unknown[]) {
    if (!isAgent(agent) || !chatId.test(id)) return Promise.reject(new Error('Invalid chat'));
    const key = PolicyResults.key(agent, id);
    const previous = this.entries.get(key)?.results;
    const results = addPolicyRecords(previous, added, policyResultsPerChat);
    if (!results.length || JSON.stringify(results) === JSON.stringify(previous || []))
      return this.writes;
    const next = new Map(this.entries);
    next.delete(key);
    next.set(key, { agent, id, results });
    this.entries = this.bounded(next);
    const snapshot = { version: 1, chats: [...this.entries.values()] };
    const task = this.writes.catch(() => {}).then(() => writeJSON(this.file, snapshot));
    this.writes = task;
    return task;
  }
  /** Saves the policy results of a run that ended. Does nothing for a draft that did not save. */
  finished(run: FinishedChatRun) {
    const id = finishedChatId(run);
    if (!id || !run.state.policies?.length) return Promise.resolve();
    return this.record(run.state.agent, id, run.state.policies);
  }
}
