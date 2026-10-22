import { readFile } from 'node:fs/promises';
import { writeJSON } from './storage/atomic-json';
import { isAgent } from '../src/config/agents';
import {
  chatOutcomeKinds,
  chatOutcomeOf,
  safeOutcomeReason,
  type ChatOutcome,
  type ChatOutcomeKind,
  type ChatOutcomeRecord,
} from '../src/domain/chat-outcome';
import type { ChatRun, Session } from '../src/domain/conversation';

/** The store keeps the outcomes of this many chats. It removes the oldest outcomes first. */
export const chatOutcomeLimit = 2000;
const sessionId = /^(?:[a-zA-Z0-9_-]{1,160}::)?[a-zA-Z0-9_-]{1,160}$/;
const hostId = /^[a-zA-Z0-9_-]{1,160}$/;
const runId = /^[a-zA-Z0-9_-]{1,160}$/;

/** Returns a valid outcome record, or undefined for a value that is not valid. */
export function validateOutcome(value: unknown): ChatOutcomeRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (!isAgent(input.agent) || typeof input.id !== 'string' || !sessionId.test(input.id))
    return undefined;
  if (!chatOutcomeKinds.includes(input.outcome as ChatOutcomeKind)) return undefined;
  const outcome = input.outcome as ChatOutcomeKind;
  if (!safeOutcomeReason(outcome, input.reason)) return undefined;
  if (typeof input.at !== 'string' || Number.isNaN(Date.parse(input.at))) return undefined;
  if (
    input.hostId !== undefined &&
    (typeof input.hostId !== 'string' || !hostId.test(input.hostId))
  )
    return undefined;
  if (input.runId !== undefined && (typeof input.runId !== 'string' || !runId.test(input.runId)))
    return undefined;
  return {
    agent: input.agent,
    id: input.id,
    outcome,
    at: new Date(input.at).toISOString(),
    ...(input.reason !== undefined ? { reason: input.reason as string } : {}),
    ...(input.hostId !== undefined ? { hostId: input.hostId as string } : {}),
    ...(input.runId !== undefined ? { runId: input.runId as string } : {}),
  };
}

/** The run of a chat that ended, with the data that the outcome store needs. */
export interface FinishedChatRun {
  state: Pick<
    ChatRun,
    'id' | 'agent' | 'status' | 'error' | 'errorCode' | 'managedCode' | 'sessionId' | 'sessionReady'
  >;
  /** The session ID that the run started with. */
  sessionId: string;
  /** True when the run started a new chat. */
  create: boolean;
  hostId?: string;
}

/**
 * The outcome record for a run that ended, or undefined when there is no saved chat to mark.
 * A new chat that did not save its session (for example a refused launch) gets no record. The
 * renderer shows the outcome of such a draft from memory only.
 */
export function outcomeRecord(
  run: FinishedChatRun,
  at = new Date().toISOString(),
): ChatOutcomeRecord | undefined {
  const outcome = chatOutcomeOf(run.state, at);
  if (!outcome) return undefined;
  if (run.create && !run.state.sessionReady) return undefined;
  const provider = run.state.sessionId || run.sessionId;
  if (!provider) return undefined;
  const id = run.hostId && !provider.includes('::') ? `${run.hostId}::${provider}` : provider;
  const record = validateOutcome({
    ...outcome,
    agent: run.state.agent,
    id,
    hostId: run.hostId,
    runId: run.state.id,
  });
  return record;
}

/** The outcome of the latest run of each chat, in `chat-outcomes.json` in the data root. */
export class ChatOutcomes {
  private entries = new Map<string, ChatOutcomeRecord>();
  private writes = Promise.resolve();
  constructor(
    private file: string,
    private limit = chatOutcomeLimit,
  ) {}
  private static key(agent: string, id: string) {
    return `${agent}:${id}`;
  }
  /** Reads the file. A damaged file or entry is ignored: the outcomes are only status data. */
  async load() {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return;
      throw error;
    }
    const rows =
      data && typeof data === 'object' && Array.isArray((data as { outcomes?: unknown }).outcomes)
        ? (data as { outcomes: unknown[] }).outcomes
        : [];
    const next = new Map<string, ChatOutcomeRecord>();
    for (const row of rows) {
      const record = validateOutcome(row);
      if (!record) continue;
      const key = ChatOutcomes.key(record.agent, record.id);
      const previous = next.get(key);
      if (!previous || previous.at < record.at) next.set(key, record);
    }
    this.entries = this.bounded(next);
  }
  private bounded(entries: Map<string, ChatOutcomeRecord>) {
    if (entries.size <= this.limit) return entries;
    return new Map(
      [...entries].sort(([, a], [, b]) => b.at.localeCompare(a.at)).slice(0, this.limit),
    );
  }
  get(agent: string, id: string): ChatOutcome | undefined {
    const record = this.entries.get(ChatOutcomes.key(agent, id));
    return record && { outcome: record.outcome, at: record.at, reason: record.reason };
  }
  list() {
    return [...this.entries.values()].sort((a, b) => b.at.localeCompare(a.at));
  }
  /** Adds the outcome of each session to a copy of the sessions. */
  decorate<T extends Pick<Session, 'agent' | 'id'>>(
    sessions: T[],
  ): (T & Pick<Session, 'outcome'>)[] {
    return sessions.map((session) => {
      const outcome = this.get(session.agent, session.id);
      return outcome ? { ...session, outcome } : session;
    });
  }
  /**
   * Keeps a new outcome. The memory changes at once, so a history read after the run ends shows
   * the outcome. The file write follows in order. An outcome older than the kept one is ignored.
   */
  record(value: ChatOutcomeRecord) {
    const record = validateOutcome(value);
    if (!record) return Promise.reject(new Error('Invalid chat outcome'));
    const key = ChatOutcomes.key(record.agent, record.id);
    const previous = this.entries.get(key);
    if (previous && (previous.at > record.at || (record.runId && previous.runId === record.runId)))
      return this.writes;
    const next = new Map(this.entries);
    next.delete(key);
    next.set(key, record);
    this.entries = this.bounded(next);
    const snapshot = { version: 1, outcomes: this.list() };
    const task = this.writes.catch(() => {}).then(() => writeJSON(this.file, snapshot));
    this.writes = task;
    return task;
  }
  /** Removes all outcomes. */
  clear() {
    this.entries = new Map();
    const task = this.writes
      .catch(() => {})
      .then(() => writeJSON(this.file, { version: 1, outcomes: [] }));
    this.writes = task;
    return task;
  }
  /** Keeps the outcome of a run that ended. Does nothing for a draft that did not save. */
  finished(run: FinishedChatRun) {
    const record = outcomeRecord(run);
    return record ? this.record(record) : Promise.resolve();
  }
}
