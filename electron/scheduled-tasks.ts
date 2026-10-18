import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ScheduledTask, Session, ChatRun } from '../src/types';

export class ScheduledTasks {
  tasks: ScheduledTask[] = [];
  private saving = Promise.resolve();
  private ticking = false;
  constructor(private file: string, private start: (task: ScheduledTask) => Promise<ChatRun>, private poll: (task: ScheduledTask) => Promise<ChatRun>, private stop: (task: ScheduledTask) => Promise<void>, private now = () => Date.now()) {}
  async load() {
    try { this.tasks = JSON.parse(await readFile(this.file, 'utf8')); if (!Array.isArray(this.tasks)) throw new Error('Invalid schedule file'); }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    for (const task of this.tasks) {
      if (task.status === 'running') { task.status = 'missed'; task.error = 'Kalkidan closed before this run finished. Review the conversation before retrying.'; }
      if (task.status === 'pending' && Date.parse(task.dueAt) <= this.now()) task.status = 'missed';
    }
    await this.save();
  }
  private save() {
    const data = JSON.stringify(this.tasks, null, 2);
    this.saving = this.saving.catch(() => {}).then(async () => { await mkdir(dirname(this.file), { recursive: true }); await writeFile(this.file + '.tmp', data, { mode: 0o600 }); await rename(this.file + '.tmp', this.file); });
    return this.saving;
  }
  async add(session: Session, prompt: string, dueAt: string) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('Enter a task prompt (up to 100,000 characters).');
    if (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= this.now()) throw new Error('Choose a future date and time.');
    const task: ScheduledTask = { id: randomUUID(), session, prompt: prompt.trim(), dueAt: new Date(dueAt).toISOString(), status: 'pending' };
    this.tasks.push(task); await this.save(); return task;
  }
  async run(id: string) {
    const task = this.tasks.find(t => t.id === id); if (!task || task.status === 'running') throw new Error('Task unavailable or already running.');
    task.status = 'running'; task.error = undefined; task.run = undefined; await this.save();
    try { task.run = await this.start(task); if (task.status !== 'running') await this.stop(task); } catch (e: any) { task.status = 'failed'; task.error = e.message; }
    await this.save();
  }
  async cancel(id: string) {
    const task = this.tasks.find(t => t.id === id); if (!task) throw new Error('Task not found');
    if (task.status === 'running' && task.run) await this.stop(task);
    task.status = 'cancelled'; await this.save();
  }
  async tick(available = true) {
    if (this.ticking) return; this.ticking = true;
    try {
      for (const task of this.tasks) {
        if (task.status === 'pending' && Date.parse(task.dueAt) <= this.now()) {
          if (!available || this.now() - Date.parse(task.dueAt) > 60000) { task.status = 'missed'; await this.save(); }
          else await this.run(task.id);
        } else if (task.status === 'running' && task.run) {
          try { task.run = await this.poll(task); if (task.run.status !== 'running') { task.status = task.run.status === 'completed' ? 'completed' : 'failed'; task.error = task.run.error; } }
          catch (e: any) { task.status = 'failed'; task.error = e.message; }
          await this.save();
        }
      }
    } finally { this.ticking = false; }
  }
}
