import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
import type { GitHubMutationReceipt } from '../../src/domain/project-batch';
import { GitHubRequestError } from './request-scheduler';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** The project lease is held by the caller. Receipts contain no tokens or request bodies. */
export class GitHubMutationJournal {
  constructor(
    private root: string,
    private project: string,
    private owned: () => void,
  ) {}
  private file() {
    return join(this.root, `journal-${hash(this.project)}.json`);
  }
  private async read(): Promise<GitHubMutationReceipt[]> {
    try {
      const text = await readFile(this.file(), 'utf8');
      if (text.length > 1024 * 1024) throw new Error('GitHub mutation history exceeds its limit.');
      const rows = JSON.parse(text);
      if (
        !Array.isArray(rows) ||
        rows.length > 1000 ||
        rows.some(
          (row) =>
            typeof row.id !== 'string' ||
            typeof row.signature !== 'string' ||
            !['writing', 'confirmed', 'rejected', 'unknown-outcome', 'reviewed'].includes(
              row.state,
            ),
        )
      )
        throw new Error('Invalid GitHub mutation history.');
      return rows.map((row) =>
        row.state === 'writing' ? { ...row, state: 'unknown-outcome' } : row,
      );
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  private async save(rows: GitHubMutationReceipt[]) {
    this.owned();
    await writeJSON(this.file(), rows);
  }
  async list() {
    return (await this.read()).map(({ signature: _signature, ...row }) => row);
  }
  async review(id: string) {
    const rows = await this.read(),
      row = rows.find((row) => row.id === id);
    if (!row || row.state !== 'unknown-outcome')
      throw new Error('This operation does not need reconciliation.');
    row.state = 'reviewed';
    row.updatedAt = Date.now();
    await this.save(rows);
  }
  async run<T>(operation: string, input: unknown, send: () => Promise<T>): Promise<T> {
    const signature = hash(JSON.stringify([this.project, operation, input]));
    let rows = await this.read();
    if (rows.some((row) => row.signature === signature && row.state === 'unknown-outcome'))
      throw new Error(
        'This GitHub write has an uncertain result. Review it in GitHub write history before sending it again.',
      );
    const unresolved = rows.filter((row) => row.state === 'unknown-outcome');
    if (unresolved.length >= 500)
      throw new Error('Review unresolved GitHub writes before making more changes.');
    rows = [...unresolved, ...rows.filter((row) => row.state !== 'unknown-outcome').slice(-99)];
    const row: GitHubMutationReceipt = {
      id: randomUUID(),
      signature,
      operation,
      state: 'writing',
      updatedAt: Date.now(),
    };
    rows.push(row);
    await this.save(rows);
    try {
      const result = await send();
      row.state = 'confirmed';
      row.updatedAt = Date.now();
      await this.save(rows);
      return result;
    } catch (error) {
      row.state =
        error instanceof GitHubRequestError &&
        ['signed-out', 'permission', 'rate-limit'].includes(error.reason)
          ? 'rejected'
          : 'unknown-outcome';
      row.updatedAt = Date.now();
      await this.save(rows);
      throw error;
    }
  }
}
