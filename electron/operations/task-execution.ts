import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';
import type { ChatRun, TaskExecutionStatus, TaskUsageHistory } from '../../src/domain/conversation';

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
  identity?: string;
  evidence?: TaskUsageHistory['evidence'];
  runId?: string;
  checkedAt?: number;
}
interface Effects {
  status?(runId: string, hostId?: string): Promise<ChatRun>;
  identity?(): Promise<string>;
  inspect(scope: TaskScope): Promise<TaskEvidence>;
  write(scope: TaskScope, evidence: TaskEvidence): Promise<void>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Native acceptance and GitHub synchronization are separate durable outcomes. */
export class TaskExecutions {
  private generation = 0;
  private watches = new Map<string, ReturnType<typeof setTimeout>>();
  private observations = new Map<
    string,
    { identity?: string; status: ChatRun['status']; governance: string; value: TaskExecutionStatus }
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
      if (text.length > 500000) throw new Error('Task execution receipt exceeds its limit.');
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
        const identity = await this.effects.identity?.();
        if (record && record.identity !== identity)
          throw new Error('The task belongs to another account.');
        if (!record) {
          record = {
            ...scope,
            identity,
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
        this.watch(run.id, scope.hostId);
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
    const identity = await this.effects.identity?.();
    const key = `${hostId || 'local'}:${run.id}`;
    const cached = this.observations.get(key);
    const governance = JSON.stringify(run.governance);
    if (
      cached?.identity === identity &&
      cached?.status === run.status &&
      cached.governance === governance
    )
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
        if (
          !record ||
          record.identity !== identity ||
          record.runId !== run.id ||
          record.hostId !== hostId
        )
          throw new Error('The task execution scope changed.');
        const result = await this.advance(record, run, owned);
        if (result.taskExecution && ['confirmed', 'blocked'].includes(result.taskExecution.sync)) {
          this.observations.set(key, {
            identity,
            status: run.status,
            governance,
            value: result.taskExecution,
          });
          if (this.observations.size > 512)
            this.observations.delete(this.observations.keys().next().value!);
        }
        return result;
      },
      id,
    );
  }
  suspend() {
    this.generation++;
    for (const timer of this.watches.values()) clearTimeout(timer);
    this.watches.clear();
    this.observations.clear();
  }
  private watch(id: string, hostId?: string, finalChecks = 0) {
    if (!this.effects.status) return;
    const key = `${hostId || 'local'}:${id}`;
    if (this.watches.has(key)) return;
    const generation = this.generation;
    const timer = setTimeout(async () => {
      this.watches.delete(key);
      try {
        const run = await this.effects.status!(id, hostId);
        if (generation !== this.generation) return;
        await this.observe(run, hostId);
        if (generation !== this.generation) return;
        if (run.status === 'running' || finalChecks < 15)
          this.watch(id, hostId, run.status === 'running' ? 0 : finalChecks + 1);
      } catch {
        /* Reconnect or account recovery restores observation; it never replays work. */
      }
    }, 2000);
    timer.unref?.();
    this.watches.set(key, timer);
  }
  async restore() {
    const generation = this.generation;
    const identity = await this.effects.identity?.();
    if (!identity) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const files = await readdir(this.root);
    if (files.length > 20000) throw Error('Task history exceeds its scan limit.');
    for (const name of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      if (generation !== this.generation) return;
      const record = await this.load(name.slice(0, -5));
      if (
        record?.identity === identity &&
        record.runId &&
        (['starting', 'active'].includes(record.phase) || Date.now() - record.updatedAt < 60000)
      )
        this.watch(record.runId, record.hostId);
    }
  }
  async history(scope: TaskScope): Promise<TaskUsageHistory[]> {
    const identity = await this.effects.identity?.();
    if (!identity) throw new Error('Sign in to view task usage history.');
    const current = await this.effects.inspect(scope);
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (files.length > 20000) throw new Error('Task history exceeds its scan limit.');
    const results: TaskUsageHistory[] = [];
    for (const name of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const record = await this.load(name.slice(0, -5));
      if (
        record?.identity === identity &&
        record.groupId === scope.groupId &&
        record.taskId === scope.taskId &&
        record.hostId === scope.hostId &&
        record.projectId === current.projectId &&
        record.runId
      )
        results.push({
          runId: record.runId,
          hostId: record.hostId,
          phase: record.phase,
          updatedAt: record.updatedAt,
          evidence: record.evidence || [],
        });
    }
    if (identity !== (await this.effects.identity?.()))
      throw new Error('Account changed while reading task history.');
    return results.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  }
  private async advance(record: Record, run: ChatRun, owned: () => void) {
    const before = JSON.stringify(record);
    if (run.governance && JSON.stringify(run.governance).length <= 20000) {
      const evidence = record.evidence || [];
      if (JSON.stringify(evidence.at(-1)?.value) !== JSON.stringify(run.governance)) {
        evidence.push({ observedAt: Date.now(), value: structuredClone(run.governance) });
        record.evidence = evidence.slice(-20);
      }
    }
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
