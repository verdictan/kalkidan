import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';
import type { ChatRun, TaskExecutionStatus } from '../../src/domain/conversation';

export interface TaskScope {
  groupId: string;
  taskId: string;
  hostId?: string;
}
export interface TaskEvidence {
  projectId: string;
  fieldId?: string;
  sourceStatus?: string;
  targetStatus?: string;
}
interface Record extends TaskScope, TaskEvidence, TaskExecutionStatus {
  runId?: string;
  checkedAt?: number;
}
interface Effects {
  inspect(scope: TaskScope): Promise<TaskEvidence>;
  write(scope: TaskScope, evidence: TaskEvidence): Promise<void>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Native acceptance and GitHub synchronization are separate durable outcomes. */
export class TaskExecutions {
  private observations = new Map<
    string,
    { status: ChatRun['status']; value: TaskExecutionStatus }
  >();
  constructor(
    private root: string,
    private effects: Effects,
  ) {}
  private file(id: string) {
    return join(this.root, `${id}.json`);
  }
  private async load(id: string): Promise<Record | undefined> {
    try {
      const text = await readFile(this.file(id), 'utf8');
      if (text.length > 20000) throw new Error('Task execution receipt exceeds its limit.');
      const value = JSON.parse(text);
      if (value.id !== id || typeof value.groupId !== 'string' || typeof value.taskId !== 'string')
        throw new Error('Invalid task execution receipt.');
      return value;
    } catch (error: any) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
  async start(operation: string, scope: TaskScope, launch: () => Promise<ChatRun>) {
    const id = digest(`${scope.hostId || 'local'}:${operation}`);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.root,
      async (owned) => {
        let record = await this.load(id);
        if (
          record &&
          (record.groupId !== scope.groupId ||
            record.taskId !== scope.taskId ||
            record.hostId !== scope.hostId)
        )
          throw new Error('The task operation belongs to another project.');
        if (!record) {
          record = {
            ...scope,
            ...(await this.effects.inspect(scope)),
            id,
            phase: 'starting',
            sync: 'pending',
            updatedAt: Date.now(),
          };
          owned();
          await writeJSON(this.file(id), record);
        }
        let run: ChatRun;
        try {
          run = await launch();
        } catch (error) {
          record.phase = record.runId ? 'interrupted' : 'launch-failed';
          owned();
          await writeJSON(this.file(id), record);
          throw error;
        }
        record.runId = run.id;
        owned();
        await writeJSON(this.file(id), record);
        await writeJSON(
          join(this.root, `run-${digest(`${scope.hostId || 'local'}:${run.id}`)}.json`),
          { id },
        );
        return this.advance(record, run, owned);
      },
      id,
    );
  }
  async observe(run: ChatRun, hostId?: string): Promise<ChatRun> {
    const key = `${hostId || 'local'}:${run.id}`;
    const cached = this.observations.get(key);
    if (cached?.status === run.status)
      return { ...run, taskExecution: structuredClone(cached.value) };
    let id: string;
    try {
      ({ id } = JSON.parse(
        await readFile(
          join(this.root, `run-${digest(`${hostId || 'local'}:${run.id}`)}.json`),
          'utf8',
        ),
      ));
    } catch (error: any) {
      if (error.code === 'ENOENT') return run;
      throw error;
    }
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid task execution index.');
    return withDirectoryLock(
      this.root,
      async (owned) => {
        const record = await this.load(id);
        if (!record || record.runId !== run.id || record.hostId !== hostId)
          throw new Error('The task execution scope changed.');
        const result = await this.advance(record, run, owned);
        if (result.taskExecution && ['confirmed', 'blocked'].includes(result.taskExecution.sync)) {
          this.observations.set(key, { status: run.status, value: result.taskExecution });
          if (this.observations.size > 512)
            this.observations.delete(this.observations.keys().next().value!);
        }
        return result;
      },
      id,
    );
  }
  private async advance(record: Record, run: ChatRun, owned: () => void) {
    const before = JSON.stringify(record);
    if (!(run.status === 'running' && ['ready-for-review', 'interrupted'].includes(record.phase)))
      record.phase =
        run.status === 'completed'
          ? 'ready-for-review'
          : run.status === 'failed' || run.status === 'stopped'
            ? 'interrupted'
            : 'active';
    if (record.sync === 'writing') {
      // A prior process may have lost the mutation response. Inspect, never replay.
      record.sync = 'unknown-outcome';
    }
    if (
      record.sync === 'pending' &&
      run.sessionReady &&
      !run.error &&
      ['running', 'completed'].includes(run.status)
    ) {
      try {
        const current = await this.effects.inspect(record);
        if (!record.fieldId || !record.targetStatus)
          throw new Error('Configure the In progress workflow mapping on the board.');
        if (
          current.projectId !== record.projectId ||
          current.fieldId !== record.fieldId ||
          current.targetStatus !== record.targetStatus
        )
          throw new Error('The project workflow changed. Review the task on the board.');
        if (current.sourceStatus === record.targetStatus) record.sync = 'confirmed';
        else {
          if (current.sourceStatus !== record.sourceStatus)
            throw new Error('The task status changed externally. Review it on the board.');
          record.sync = 'writing';
          owned();
          await writeJSON(this.file(record.id), record);
          try {
            await this.effects.write(record, record);
            record.sync = 'confirmed';
          } catch {
            record.sync = 'unknown-outcome';
            record.message =
              'The agent started. GitHub did not confirm the status change. Refresh the board before changing it.';
          }
        }
      } catch (error) {
        record.sync = 'blocked';
        record.message = error instanceof Error ? error.message : 'Task synchronization failed.';
      }
    }
    if (record.sync === 'unknown-outcome' && Date.now() - (record.checkedAt || 0) >= 30000) {
      record.checkedAt = Date.now();
      try {
        const current = await this.effects.inspect(record);
        if (
          current.projectId === record.projectId &&
          current.fieldId === record.fieldId &&
          current.sourceStatus === record.targetStatus
        ) {
          record.sync = 'confirmed';
          delete record.message;
        }
      } catch {
        /* Keep the unresolved write. Observation cannot replay a prompt or mutation. */
      }
    }
    if (before !== JSON.stringify(record)) {
      record.updatedAt = Date.now();
      owned();
      await writeJSON(this.file(record.id), record);
    }
    return {
      ...run,
      taskExecution: {
        id: record.id,
        phase: record.phase,
        sync: record.sync,
        message: record.message,
        updatedAt: record.updatedAt,
      },
    };
  }
}
