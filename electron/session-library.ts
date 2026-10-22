import { readFile } from 'node:fs/promises';
import { writeJSON } from './storage/atomic-json';
import type { Agent, Session, SessionOrganization } from '../src/types';
import type { ChatOutcomes } from './chat-outcomes';

export function validateOrganization(value: unknown): SessionOrganization {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid session settings');
  const input = value as Record<string, unknown>;
  const result: SessionOrganization = {};
  for (const key of ['title', 'notes', 'collection', 'taskId'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > (key === 'notes' ? 20000 : 160))
        throw new Error(`Invalid session ${key}`);
      result[key] = input[key].trim();
    }
  }
  for (const key of ['pinned', 'archived', 'importHidden'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error(`Invalid session ${key}`);
      result[key] = input[key];
    }
  }
  return result;
}
export class SessionLibrary {
  private entries = new Map<string, SessionOrganization>();
  private writes = Promise.resolve();
  constructor(
    private file: string,
    /** With it, each decorated session also gets the outcome of its latest run. */
    private outcomes?: Pick<ChatOutcomes, 'get'>,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Invalid session library');
      this.entries = new Map(
        Object.entries(data).map(([key, value]) => [key, validateOrganization(value)]),
      );
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  decorate(sessions: Session[]) {
    return sessions.map((session) => {
      const outcome = this.outcomes?.get(session.agent, session.id);
      return {
        ...session,
        organization: this.entries.get(`${session.agent}:${session.id}`) || {},
        ...(outcome ? { outcome } : {}),
      };
    });
  }
  /** Removes all titles, notes, and other organization of the sessions. */
  async clear() {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        await writeJSON(this.file, {});
        this.entries = new Map();
      });
    this.writes = task;
    await task;
  }
  async update(agent: Agent, id: string, changes: unknown) {
    return this.updateMany([{ agent, id, changes }]);
  }
  async updateMany(entries: { agent: Agent; id: string; changes: unknown }[]) {
    const patches = entries.map((entry) => ({
      ...entry,
      changes: validateOrganization(entry.changes),
    }));
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        const next = new Map(this.entries);
        for (const { agent, id, changes } of patches) {
          const key = `${agent}:${id}`;
          next.set(key, { ...next.get(key), ...changes });
        }
        await writeJSON(this.file, Object.fromEntries(next));
        this.entries = next;
      });
    this.writes = task;
    await task;
  }
}
