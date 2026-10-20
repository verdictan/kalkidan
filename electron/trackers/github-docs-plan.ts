import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withDirectoryLock } from '../storage/directory-lock';
import { writeJSON } from '../storage/atomic-json';
import type { DocsIssuePlan, DocsIssuePlanResult } from '../../src/domain/docs-plan';
import type { TrackerBoard } from '../../src/domain/tracker';
import type { IssueRelations, IssueRelationAction } from '../../src/domain/github-relations';
interface Effects {
  prepare(): Promise<void>;
  board(): Promise<TrackerBoard>;
  create(title: string, body: string): Promise<string>;
  convert(item: string, repository: string): Promise<void>;
  relations(item: string): Promise<IssueRelations>;
  relate(item: string, revision: string, action: IssueRelationAction): Promise<unknown>;
}
/** Each stage is recoverable from GitHub state. Uncertain creation is never blindly replayed. */
export class GitHubDocsPlan {
  constructor(private root: string) {}
  async run(
    projectId: string,
    plan: DocsIssuePlan,
    effects: Effects,
  ): Promise<DocsIssuePlanResult> {
    if (
      !plan ||
      !/^[a-f0-9-]{36}$/i.test(plan.id) ||
      !/^[\w.-]+\/[\w.-]+$/.test(plan.repository) ||
      !Array.isArray(plan.entries) ||
      !plan.entries.length ||
      plan.entries.length > 20
    )
      throw new Error('Choose a repository and between 1 and 20 proposed issues.');
    for (const [index, entry] of plan.entries.entries()) {
      if (
        !entry ||
        typeof entry.title !== 'string' ||
        !entry.title.trim() ||
        entry.title.length > 256 ||
        typeof entry.body !== 'string' ||
        entry.body.length > 19000
      )
        throw new Error('Each issue needs a title and a description within the size limits.');
      if (
        entry.parent !== undefined &&
        (!Number.isInteger(entry.parent) || entry.parent < 0 || entry.parent >= index)
      )
        throw new Error('A parent must be an earlier issue in this plan.');
      if (
        entry.blockedBy !== undefined &&
        (!Array.isArray(entry.blockedBy) ||
          new Set(entry.blockedBy).size !== entry.blockedBy.length ||
          entry.blockedBy.some((value) => !Number.isInteger(value) || value < 0 || value >= index))
      )
        throw new Error('Dependencies must refer to earlier issues in this plan.');
    }
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const signature = hash(JSON.stringify({ projectId, plan })),
      key = hash(plan.id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return withDirectoryLock(
      this.root,
      async (owned) => {
        const file = join(this.root, key + '.json');
        let record: { signature: string; result: DocsIssuePlanResult };
        try {
          const text = await readFile(file, 'utf8');
          if (text.length > 100000) throw new Error('Invalid issue plan receipt.');
          record = JSON.parse(text);
          if (record.signature !== signature)
            throw new Error('This plan ID belongs to a different request.');
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
          record = {
            signature,
            result: {
              id: plan.id,
              rows: plan.entries.map((_, index) => ({ index, state: 'pending' })),
            },
          };
        }
        const save = async () => {
          owned();
          await writeJSON(file, record);
        };
        await effects.prepare();
        await save();
        for (const row of record.result.rows) {
          if (row.state === 'complete') continue;
          const entry = plan.entries[row.index],
            marker = `<!-- kalkidan-plan:${plan.id}:${row.index} -->`,
            body = entry.body + '\n\n' + marker;
          try {
            let board = await effects.board();
            if (board.project.id !== projectId || board.writable !== true)
              throw new Error('Project write access is required.');
            if (!row.itemId) {
              const existing = [...board.items, ...(board.archivedItems || [])].filter((item) =>
                item.body.includes(marker),
              );
              if (existing.length > 1)
                throw new Error('More than one matching item exists. Review the plan on GitHub.');
              if (existing.length === 1) {
                row.itemId = existing[0].id;
                row.state = 'created';
                await save();
              } else if (row.state === 'creating')
                throw new Error(
                  'The previous creation is uncertain. Inspect GitHub before starting a different plan.',
                );
              else {
                row.state = 'creating';
                await save();
                row.itemId = await effects.create(entry.title.trim(), body);
                row.state = 'created';
                await save();
              }
              board = await effects.board();
            }
            const item = board.items.find((item) => item.id === row.itemId);
            if (!item)
              throw new Error(
                'The created item was removed or archived. Restore it before resuming.',
              );
            if (item.title !== entry.title.trim() || item.body !== body)
              throw new Error(
                'The created item changed after review. Inspect it on GitHub before continuing.',
              );
            if (item.kind === 'DraftIssue') {
              if (row.state === 'converting')
                throw new Error(
                  'The prior conversion is uncertain. Inspect GitHub before requesting another conversion.',
                );
              row.state = 'converting';
              await save();
              await effects.convert(row.itemId, plan.repository);
              board = await effects.board();
            }
            const issue = board.items.find((item) => item.id === row.itemId);
            if (
              issue?.kind !== 'Issue' ||
              issue.repository?.toLowerCase() !== plan.repository.toLowerCase() ||
              !issue.url
            )
              throw new Error('Issue conversion was not confirmed in the requested repository.');
            row.state = 'linked';
            await save();
            if (entry.parent !== undefined) {
              const parent = record.result.rows[entry.parent];
              if (parent.state !== 'complete' || !parent.itemId)
                throw new Error('Complete the parent issue first.');
              const parentRelations = await effects.relations(parent.itemId);
              const childRelations = await effects.relations(row.itemId);
              if (!parentRelations.subIssues.some((child) => child.id === childRelations.issueId))
                await effects.relate(parent.itemId, parentRelations.revision, {
                  kind: 'add-child',
                  url: issue.url,
                });
            }
            for (const index of entry.blockedBy || []) {
              const previous = record.result.rows[index];
              if (previous.state !== 'complete' || !previous.itemId)
                throw new Error('Complete the dependency issue first.');
              const blocker = board.items.find((item) => item.id === previous.itemId);
              if (!blocker?.url) throw new Error('The dependency is no longer available.');
              const current = await effects.relations(row.itemId),
                target = await effects.relations(previous.itemId);
              if (!current.blockedBy.some((issue) => issue.id === target.issueId))
                await effects.relate(row.itemId, current.revision, {
                  kind: 'add-blocker',
                  url: blocker.url,
                });
            }
            row.state = 'complete';
            delete row.message;
            await save();
          } catch (error) {
            row.message = error instanceof Error ? error.message : 'Issue planning failed.';
            await save();
            break;
          }
        }
        return record.result;
      },
      key,
    );
  }
}
