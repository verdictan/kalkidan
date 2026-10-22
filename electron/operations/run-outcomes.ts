import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import { outcomeRecord, validateOutcome, type FinishedChatRun } from '../chat-outcomes';
import type { ChatOutcomeRecord } from '../../src/domain/chat-outcome';

/** The log keeps the outcomes of this many runs. It removes the oldest outcomes first. */
export const runOutcomeLimit = 200;
const runFile = /^[a-zA-Z0-9_-]{1,160}\.json$/;

/**
 * The outcomes of the runs that ended on an SSH host. The helper keeps them on the host, so the
 * desktop can read an outcome that it did not see, for example when the app quit during a run.
 * Each run has its own file. Thus two helper processes on the same host do not overwrite the
 * outcomes of each other. A damaged file is ignored: the outcomes are only status data.
 */
export class RunOutcomeLog {
  constructor(
    private root: string,
    private limit = runOutcomeLimit,
  ) {}
  /** Keeps the outcome of a run that ended. Does nothing for a draft that did not save. */
  async finished(run: FinishedChatRun, at = new Date().toISOString()) {
    const record = outcomeRecord(run, at);
    if (!record?.runId) return;
    await writeJSON(join(this.root, `${record.runId}.json`), record);
  }
  /**
   * The outcome of the latest run of each chat, the newest first. It removes the files of the
   * oldest runs when the log has more than `limit` runs.
   */
  async list(): Promise<ChatOutcomeRecord[]> {
    let names: string[];
    try {
      names = (await readdir(this.root)).filter((name) => runFile.test(name));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const records: { name: string; record: ChatOutcomeRecord }[] = [];
    for (const name of names) {
      try {
        const text = await readFile(join(this.root, name), 'utf8');
        if (text.length > 4096) continue;
        const record = validateOutcome(JSON.parse(text));
        if (record?.runId && `${record.runId}.json` === name) records.push({ name, record });
      } catch {
        // A file that another process writes now, or a damaged file.
      }
    }
    records.sort((a, b) => b.record.at.localeCompare(a.record.at));
    for (const { name } of records.splice(this.limit))
      await rm(join(this.root, name), { force: true }).catch(() => {});
    const latest = new Map<string, ChatOutcomeRecord>();
    for (const { record } of records) {
      const key = `${record.agent}:${record.id}`;
      if (!latest.has(key)) latest.set(key, record);
    }
    return [...latest.values()];
  }
}
