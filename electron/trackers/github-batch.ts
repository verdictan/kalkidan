import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';
import type { TrackerBoard } from '../../src/domain/tracker';
import {
  projectFieldValue,
  sameProjectValue,
  type ProjectBatchRequest,
  type ProjectBatchResult,
  type ProjectBatchChange,
} from '../../src/domain/project-batch';
/** Persist dispatch before a write. Resuming observes uncertain writes and never repeats them. */
export class GitHubProjectBatch {
  constructor(private root: string) {}
  async run(
    projectId: string,
    request: ProjectBatchRequest,
    read: (change: ProjectBatchChange) => Promise<TrackerBoard>,
    write: (change: ProjectBatchChange) => Promise<void>,
  ): Promise<ProjectBatchResult> {
    if (
      !request ||
      !/^[a-f0-9-]{36}$/i.test(request.id) ||
      !Array.isArray(request.changes) ||
      !request.changes.length ||
      request.changes.length > 50
    )
      throw new Error('Choose between 1 and 50 field changes.');
    const keys = new Set<string>();
    for (const change of request.changes) {
      if (
        !change ||
        !/^[\w-]{1,200}$/.test(change.itemId) ||
        !/^[\w-]{1,200}$/.test(change.fieldId) ||
        change.before === undefined ||
        change.value === undefined
      )
        throw new Error('Invalid batch field change.');
      const key = `${change.itemId}:${change.fieldId}`;
      if (keys.has(key)) throw new Error('Each item and field must occur once in a batch.');
      keys.add(key);
    }
    const serialized = JSON.stringify({ projectId, request });
    if (serialized.length > 1024 * 1024) throw new Error('The batch exceeds its size limit.');
    const signature = createHash('sha256').update(serialized).digest('hex');
    const key = createHash('sha256').update(request.id).digest('hex');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.root,
      async (owned) => {
        const file = join(this.root, `${key}.json`);
        let record: { signature: string; result: ProjectBatchResult };
        try {
          const text = await readFile(file, 'utf8');
          if (text.length > 100000) throw new Error('Invalid batch receipt.');
          record = JSON.parse(text);
          if (record.signature !== signature)
            throw new Error('This batch ID belongs to a different request.');
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
          record = {
            signature,
            result: {
              id: request.id,
              rows: request.changes.map((change) => ({
                itemId: change.itemId,
                fieldId: change.fieldId,
                state: 'pending',
              })),
            },
          };
          owned();
          await writeJSON(file, record);
        }
        for (let index = 0; index < request.changes.length; index++) {
          const row = record.result.rows[index],
            change = request.changes[index];
          if (row.state === 'confirmed' || row.state === 'conflict') continue;
          const uncertain = row.state === 'writing' || row.state === 'unknown-outcome';
          if (uncertain) row.state = 'unknown-outcome';
          try {
            const board = await read(change);
            if (board.project.id !== projectId || board.writable !== true)
              throw new Error('Project access changed.');
            const item = board.items.find((item) => item.id === change.itemId);
            if (!item || !board.fields?.some((field) => field.id === change.fieldId))
              throw new Error('The item or field is no longer available.');
            const current = projectFieldValue(item, change.fieldId);
            if (sameProjectValue(current, change.value)) {
              row.state = 'confirmed';
              delete row.message;
            } else if (uncertain)
              row.message =
                'The previous write is uncertain. Review this field on GitHub. This request will not repeat it.';
            else if (!sameProjectValue(current, change.before)) {
              row.state = 'conflict';
              row.message = 'The field changed after preview. Prepare a new batch.';
            } else {
              row.state = 'writing';
              owned();
              await writeJSON(file, record);
              try {
                await write(change);
                row.state = 'confirmed';
                delete row.message;
              } catch {
                row.state = 'unknown-outcome';
                row.message =
                  'GitHub did not confirm this field change. Resume to inspect its value.';
              }
            }
          } catch (error) {
            row.message = error instanceof Error ? error.message : 'Cannot inspect this item.';
          }
          owned();
          await writeJSON(file, record);
        }
        return record.result;
      },
      key,
    );
  }
}
