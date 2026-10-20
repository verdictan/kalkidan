import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withDirectoryLock } from '../storage/directory-lock';
import { writeJSON } from '../storage/atomic-json';
export interface ProjectCreationRequest {
  id: string;
  name: string;
  reference: string;
  provider: string;
  hostId?: string;
  root?: string;
  paths?: string[];
}
export interface ProjectCreationRecord {
  request: ProjectCreationRequest;
  phase:
    | 'validating'
    | 'preparing-root'
    | 'creating-project'
    | 'adding-repositories'
    | 'completed'
    | 'partially-completed'
    | 'failed';
  root?: string;
  added: string[];
  error?: string;
}
export interface ProjectCreationEffects {
  exists(id: string): boolean;
  resolve(request: ProjectCreationRequest): Promise<unknown>;
  prepare(request: ProjectCreationRequest): Promise<string>;
  create(request: ProjectCreationRequest, root: string, connection: unknown): Promise<void>;
  add(id: string, path: string): Promise<void>;
}
/** The request ID also owns the project folder marker. Retries reuse both. */
export class ProjectCreation {
  constructor(
    private root: string,
    private effects: ProjectCreationEffects,
  ) {}
  private file(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))
      throw new Error('Invalid project operation ID.');
    return join(this.root, `${id}.json`);
  }
  async status(id: string): Promise<ProjectCreationRecord | null> {
    try {
      const text = await readFile(this.file(id), 'utf8');
      if (text.length > 1024 * 1024) throw new Error('Invalid project operation.');
      const row = JSON.parse(text);
      if (row.request?.id !== id || !Array.isArray(row.added))
        throw new Error('Invalid project operation.');
      return row;
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async run(request: ProjectCreationRequest): Promise<string> {
    const file = this.file(request.id);
    if (
      typeof request.name !== 'string' ||
      !request.name.trim() ||
      request.name.length > 150 ||
      typeof request.reference !== 'string' ||
      request.reference.length > 1000 ||
      typeof request.provider !== 'string' ||
      !/^[a-z][a-z0-9-]*$/.test(request.provider) ||
      (request.hostId !== undefined && typeof request.hostId !== 'string') ||
      (request.root !== undefined && typeof request.root !== 'string') ||
      (request.paths !== undefined &&
        (!Array.isArray(request.paths) ||
          request.paths.length > 500 ||
          request.paths.some((path) => typeof path !== 'string' || !path || path.length > 4096)))
    )
      throw new Error('Invalid project creation request.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.root,
      async (assertOwned) => {
        let record = await this.status(request.id);
        if (record && JSON.stringify(record.request) !== JSON.stringify(request))
          throw new Error(
            'This operation belongs to a different request. Resume its original project creation.',
          );
        record ||= { request: structuredClone(request), phase: 'validating', added: [] };
        const save = async (phase: ProjectCreationRecord['phase']) => {
          assertOwned();
          record!.phase = phase;
          record!.error = undefined;
          await writeJSON(file, record);
        };
        if (record.phase === 'completed') {
          if (!this.effects.exists(request.id))
            throw new Error('This project was removed. Start a new creation operation.');
          return request.id;
        }
        try {
          await save('validating');
          if (!this.effects.exists(request.id)) {
            const connection = await this.effects.resolve(request);
            await save('preparing-root');
            record.root = await this.effects.prepare(request);
            await save('creating-project');
            await this.effects.create(request, record.root, connection);
          }
          for (const path of new Set(request.paths || [])) {
            if (record.added.includes(path)) continue;
            await save('adding-repositories');
            await this.effects.add(request.id, path);
            record.added.push(path);
            await save('adding-repositories');
          }
          await save('completed');
          return request.id;
        } catch (error) {
          record.phase = this.effects.exists(request.id) ? 'partially-completed' : 'failed';
          record.error =
            'Project setup stopped. Retry this operation to resume the unfinished step.';
          assertOwned();
          await writeJSON(file, record);
          throw error;
        }
      },
      createHash('sha256').update(request.id).digest('hex'),
    );
  }
}
