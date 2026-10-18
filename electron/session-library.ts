import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Agent, Session, SessionOrganization } from '../src/types';

export function validateOrganization(value: unknown): SessionOrganization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session settings');
  const input = value as Record<string, unknown>;
  const result: SessionOrganization = {};
  for (const key of ['title', 'notes', 'collection', 'taskId'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > (key === 'notes' ? 20000 : 160)) throw new Error(`Invalid session ${key}`);
      result[key] = input[key].trim();
    }
  }
  for (const key of ['pinned', 'archived'] as const) {
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
  constructor(private file: string) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid session library');
      this.entries = new Map(Object.entries(data).map(([key, value]) => [key, validateOrganization(value)]));
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  decorate(sessions: Session[]) {
    return sessions.map(session => ({ ...session, organization: this.entries.get(`${session.agent}:${session.id}`) || {} }));
  }
  async update(agent: Agent, id: string, changes: unknown) {
    const patch = validateOrganization(changes);
    const task = this.writes.catch(() => {}).then(async () => {
      const key = `${agent}:${id}`;
      const next = new Map(this.entries);
      next.set(key, { ...next.get(key), ...patch });
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify(Object.fromEntries(next), null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      this.entries = next;
    });
    this.writes = task;
    await task;
  }
}
