import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';
import type { ChatRun } from '../../src/domain/conversation';
/** A lost start response cannot replay a prompt, including after helper/app restart. */
export class AgentStarts {
  private pending = new Map<string, { signature: string; task: Promise<ChatRun> }>();
  constructor(
    private root: string,
    private status: (id: string) => ChatRun,
  ) {}
  run(
    operationId: string | undefined,
    identity: unknown,
    start: () => Promise<ChatRun>,
  ): Promise<ChatRun> {
    const id = operationId || randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))
      return Promise.reject(new Error('Invalid agent operation ID.'));
    const signature = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const pending = this.pending.get(id);
    if (pending)
      return pending.signature === signature
        ? pending.task
        : Promise.reject(new Error('The agent operation belongs to a different request.'));
    const task = this.perform(id, signature, start);
    this.pending.set(id, { signature, task });
    void task.then(
      () => this.pending.delete(id),
      () => this.pending.delete(id),
    );
    return task;
  }
  private async perform(id: string, signature: string, start: () => Promise<ChatRun>) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.root,
      async (assertOwned) => {
        const file = join(this.root, `${id}.json`);
        let saved: { signature: string; runId?: string } | undefined;
        try {
          const text = await readFile(file, 'utf8');
          if (text.length > 2048) throw new Error('Invalid agent receipt.');
          saved = JSON.parse(text);
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (saved) {
          if (saved.signature !== signature)
            throw new Error('The agent operation belongs to a different request.');
          if (saved.runId)
            try {
              return this.status(saved.runId);
            } catch {
              /* A different process owns the old receipt. */
            }
          throw new Error(
            'The previous send result is uncertain or its process stopped. Inspect the session history before sending a new message.',
          );
        }
        assertOwned();
        await writeJSON(file, { signature });
        const result = await start();
        assertOwned();
        await writeJSON(file, { signature, runId: result.id });
        return result;
      },
      createHash('sha256').update(id).digest('hex'),
    );
  }
}
