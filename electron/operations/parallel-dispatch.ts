import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';
import type { DispatchPlan, DispatchRequest } from '../../src/domain/parallel-dispatch';
import type { ChatRun } from '../../src/domain/conversation';
interface Effects {
  identity(): Promise<string>;
  inspect(
    request: DispatchRequest,
    task: DispatchRequest['tasks'][number],
  ): Promise<{ title: string; prompt: string; revision: string }>;
  checkout(repositoryId: string, branch: string, operationId: string): Promise<string>;
  launch(request: DispatchRequest, row: DispatchPlan['rows'][number]): Promise<ChatRun>;
  status(request: DispatchRequest, row: DispatchPlan['rows'][number]): Promise<ChatRun>;
  reconcile?(
    request: DispatchRequest,
    row: DispatchPlan['rows'][number],
  ): Promise<{ run?: ChatRun; canRelease: boolean }>;
  stop(request: DispatchRequest, row: DispatchPlan['rows'][number]): Promise<unknown>;
}
type Record = { identity: string; signature: string; plan: DispatchPlan };
const uuid = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
/** One durable queue owns dispatch; uncertain starts never replay after restart. */
export class ParallelDispatch {
  private closed = false;
  private suspended = false;
  private generation = 0;
  private errors = new Map<string, string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private root: string,
    private effects: Effects,
  ) {}
  private async locked<T>(id: string, work: (owned: () => void) => Promise<T>) {
    if (!uuid(id)) throw Error('Invalid dispatch identifier.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(this.root, work, createHash('sha256').update(id).digest('hex'));
  }
  private async read(id: string): Promise<Record> {
    const text = await readFile(join(this.root, id + '.json'), 'utf8');
    if (text.length > 500000) throw Error('Dispatch record exceeds its limit.');
    const value = JSON.parse(text);
    if (value.plan?.id !== id || !Array.isArray(value.plan.rows) || value.plan.rows.length > 20)
      throw Error('Invalid dispatch record.');
    if (value.identity !== (await this.effects.identity()))
      throw Error('Sign in with the account that prepared this dispatch.');
    return value;
  }
  private async save(value: Record, owned: () => void) {
    owned();
    await writeJSON(join(this.root, value.plan.id + '.json'), value);
  }
  async prepare(request: DispatchRequest) {
    if (
      !request ||
      !uuid(request.id) ||
      typeof request.groupId !== 'string' ||
      !request.groupId ||
      request.groupId.length > 200 ||
      !['codex', 'claude'].includes(request.agent) ||
      !Number.isInteger(request.concurrency) ||
      request.concurrency < 1 ||
      request.concurrency > 4 ||
      !Array.isArray(request.tasks) ||
      !request.tasks.length ||
      request.tasks.length > 20 ||
      request.tasks.some(
        (t) =>
          !t ||
          typeof t.taskId !== 'string' ||
          !t.taskId ||
          t.taskId.length > 200 ||
          typeof t.repositoryId !== 'string' ||
          !t.repositoryId ||
          t.repositoryId.length > 200,
      ) ||
      new Set(request.tasks.map((t) => t.taskId)).size !== request.tasks.length
    )
      throw Error('Select 1–20 unique tasks and 1–4 parallel agents.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(this.root, () =>
      this.locked(request.id, async (owned) => {
        const signature = createHash('sha256').update(JSON.stringify(request)).digest('hex');
        try {
          const existing = await this.read(request.id);
          if (existing.signature !== signature)
            throw Error('Dispatch ID belongs to a different plan.');
          return existing.plan;
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
        const identity = await this.effects.identity();
        const entries = await readdir(this.root);
        if (entries.length > 10000)
          throw Error('Archive dispatch records before preparing more plans.');
        for (const name of entries.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
          const text = await readFile(join(this.root, name), 'utf8');
          if (text.length > 500000) throw Error('Invalid dispatch record.');
          const other = JSON.parse(text) as Record;
          if (
            other.plan.groupId === request.groupId &&
            other.plan.rows.some(
              (row) =>
                request.tasks.some((task) => task.taskId === row.taskId) &&
                !['completed', 'canceled'].includes(row.state),
            )
          )
            throw Error(
              'A selected task already belongs to a dispatch plan. Resolve that plan first.',
            );
        }
        const rows: DispatchPlan['rows'] = [];
        for (const task of request.tasks) {
          const evidence = await this.effects.inspect(request, task);
          if (
            evidence.prompt.length > 16000 ||
            evidence.title.length > 1000 ||
            evidence.revision.length > 200
          )
            throw Error('Task exceeds the dispatch review limit.');
          rows.push({
            ...task,
            ...evidence,
            operationId: randomUUID(),
            branch: `kalkidan/task-${randomUUID()}`,
            state: 'queued',
          });
        }
        if (identity !== (await this.effects.identity()))
          throw Error('Account changed during preparation.');
        const record: Record = {
          identity,
          signature,
          plan: { ...structuredClone(request), rows, state: 'review' },
        };
        await this.save(record, owned);
        return record.plan;
      }),
    );
  }
  async start(id: string) {
    if (this.closed) throw Error('Dispatch owner is closed.');
    const plan = await this.locked(id, async (owned) => {
      const record = await this.read(id);
      if (['review', 'paused'].includes(record.plan.state)) record.plan.state = 'running';
      await this.save(record, owned);
      return record.plan;
    });
    this.suspended = false;
    if (
      plan.state === 'running' ||
      (plan.state === 'paused' && plan.rows.some((row) => row.state === 'running'))
    )
      this.schedule(id);
    return plan;
  }
  private schedule(id: string) {
    if (this.closed || this.suspended || this.timers.has(id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.tick(id)
        .then((plan) => {
          this.errors.delete(id);
          if (
            plan.state === 'running' ||
            (plan.state === 'paused' && plan.rows.some((row) => row.state === 'running'))
          )
            this.schedule(id);
        })
        .catch((error) => {
          this.errors.set(
            id,
            error instanceof Error ? error.message : 'Dispatch observation failed.',
          );
        });
    }, 1000);
    timer.unref?.();
    this.timers.set(id, timer);
  }
  async status(id: string) {
    const plan = await this.locked(id, async () => (await this.read(id)).plan);
    const failure = this.errors.get(id);
    if (failure) {
      this.errors.delete(id);
      throw Error(failure);
    }
    if (
      plan.state === 'running' ||
      (plan.state === 'paused' && plan.rows.some((row) => row.state === 'running'))
    )
      this.schedule(id);
    return plan;
  }
  async tick(id: string) {
    const generation = this.generation;
    return this.locked(id, async (owned) => {
      const record = await this.read(id),
        plan = record.plan;
      if (this.suspended || this.closed || !['running', 'paused'].includes(plan.state)) return plan;
      for (const row of plan.rows) {
        if (row.state === 'dispatching') {
          row.state = 'uncertain';
          row.message = 'Start was interrupted. Inspect sessions before creating another plan.';
        }
        if (row.state === 'running') {
          try {
            const run = await this.effects.status(plan, row);
            if (run.status !== 'running') {
              row.state =
                run.status === 'completed'
                  ? 'completed'
                  : run.status === 'stopped'
                    ? 'canceled'
                    : 'failed';
              row.message = run.error;
            }
          } catch {
            row.state = 'uncertain';
            row.message = 'Cannot confirm the running session. No prompt was replayed.';
          }
        }
      }
      if (plan.rows.some((row) => ['uncertain', 'failed'].includes(row.state)))
        plan.state = 'paused';
      let slots = plan.concurrency - plan.rows.filter((row) => row.state === 'running').length;
      for (const row of plan.rows) {
        if (
          this.suspended ||
          generation !== this.generation ||
          plan.state !== 'running' ||
          slots <= 0
        )
          break;
        if (!['queued', 'preparing'].includes(row.state)) continue;
        try {
          const current = await this.effects.inspect(plan, row);
          if (current.revision !== row.revision)
            throw Error('Task changed after review. Prepare a new plan.');
          row.state = 'preparing';
          await this.save(record, owned);
          row.checkoutId = await this.effects.checkout(
            row.repositoryId,
            row.branch,
            row.operationId,
          );
          if (
            this.closed ||
            this.suspended ||
            generation !== this.generation ||
            record.identity !== (await this.effects.identity())
          )
            throw Error('Dispatch stopped because the application or account changed.');
          row.state = 'dispatching';
          await this.save(record, owned);
          const run = await this.effects.launch(plan, row);
          row.runId = run.id;
          row.state =
            run.status === 'running'
              ? 'running'
              : run.status === 'completed'
                ? 'completed'
                : 'failed';
          row.message = run.error;
          slots--;
          await this.save(record, owned);
          if (row.state === 'failed') plan.state = 'paused';
        } catch (error) {
          row.state = row.state === 'dispatching' ? 'uncertain' : 'failed';
          row.message = error instanceof Error ? error.message : 'Dispatch failed.';
          plan.state = 'paused';
        }
      }
      if (plan.rows.every((row) => ['completed', 'canceled'].includes(row.state)))
        plan.state = plan.rows.some((row) => row.state === 'completed') ? 'completed' : 'canceled';
      await this.save(record, owned);
      return plan;
    });
  }
  async cancel(id: string) {
    return this.locked(id, async (owned) => {
      const record = await this.read(id);
      record.plan.state = 'canceled';
      await this.save(record, owned);
      for (const row of record.plan.rows) {
        if (row.state === 'running') {
          try {
            await this.effects.stop(record.plan, row);
            row.state = 'canceled';
          } catch {
            row.state = 'uncertain';
            row.message = 'Stop was not confirmed.';
          }
        } else if (['queued', 'preparing', 'failed'].includes(row.state)) row.state = 'canceled';
      }
      await this.save(record, owned);
      return record.plan;
    });
  }
  async reconcile(id: string, taskId: string, release = false) {
    if (typeof taskId !== 'string' || typeof release !== 'boolean')
      throw Error('Invalid recovery request.');
    return this.locked(id, async (owned) => {
      const record = await this.read(id);
      const row = record.plan.rows.find((row) => row.taskId === taskId);
      if (
        !row ||
        !['uncertain', 'failed', 'dispatching'].includes(row.state) ||
        !this.effects.reconcile
      )
        throw Error('This task does not need recovery.');
      const result = await this.effects.reconcile(record.plan, row);
      if (record.identity !== (await this.effects.identity()))
        throw Error('Account changed during recovery.');
      if (result.run) {
        row.runId = result.run.id;
        row.state =
          result.run.status === 'running'
            ? 'running'
            : result.run.status === 'completed'
              ? 'completed'
              : 'failed';
        row.message = result.run.error;
      }
      if (release) {
        if (!result.canRelease || result.run?.status === 'running')
          throw Error('Stop the owned session before releasing this task.');
        row.state = 'canceled';
        row.message =
          'Task released after explicit session inspection. The previous prompt was not replayed.';
      } else if (!result.run)
        row.message =
          'No live run could be recovered. Inspect session history, then release this task explicitly.';
      if (record.plan.state !== 'canceled' || row.state === 'running') record.plan.state = 'paused';
      await this.save(record, owned);
      if (row.state === 'running') this.schedule(id);
      return record.plan;
    });
  }
  suspend() {
    this.suspended = true;
    this.generation++;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
  async restore() {
    if (this.closed) return;
    const generation = this.generation;
    const identity = await this.effects.identity();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root);
    if (entries.length > 10000) throw Error('Dispatch history exceeds its limit.');
    if (this.closed || generation !== this.generation) return;
    this.suspended = false;
    for (const name of entries.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      try {
        const record = await this.read(name.slice(0, -5));
        if (record.identity === identity && ['running', 'paused'].includes(record.plan.state))
          this.schedule(record.plan.id);
      } catch (error: any) {
        if (String(error.message).includes('account that prepared')) continue;
        throw error;
      }
    }
  }
  close() {
    this.closed = true;
    this.suspend();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
