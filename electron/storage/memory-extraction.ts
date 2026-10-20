import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { ManagedMemory, unsafeMemory, type MemoryScope } from './managed-memory';
import { memoryDirectory, memoryRuntimeId } from './project-memory';
import { writeJSON } from './atomic-json';
import { withDirectoryLock } from './directory-lock';
import type { MemoryCandidate, MemoryExtraction } from '../../src/domain/memory';

export type MemoryExtractor = (input: string, signal: AbortSignal) => Promise<string>;
const running = new Map<string, Promise<MemoryExtraction>>();
let tail: Promise<unknown> = Promise.resolve();
export const extractionLimits = { input: 12000, candidates: 5, output: 16000 };

/** One background extraction at a time. Persist outcomes, never raw turn transcripts. */
export function extractMemory(
  scope: MemoryScope,
  extract: MemoryExtractor,
  signal: AbortSignal,
  changed: () => void = () => {},
): Promise<MemoryExtraction> {
  const jobId = createHash('sha256')
    .update(JSON.stringify([scope.sessionId, scope.turnId]))
    .digest('hex');
  const identity = join(scope.root, jobId);
  const active = running.get(identity);
  if (active) return active;
  const operation = execute().finally(() => {
    if (running.get(identity) === operation) running.delete(identity);
  });
  running.set(identity, operation);
  return operation;
  async function execute() {
    const directory = await memoryDirectory(scope.root);
    return withDirectoryLock(
      directory,
      (assertOwned) => executeLocked(directory, assertOwned),
      jobId,
    );
  }
  async function executeLocked(directory: string, assertOwned: () => void) {
    let remaining = extractionLimits.input;
    const sources = scope
      .sources()
      .slice(0, 6)
      .map(({ id, text }) => {
        const result = { id, text: text.slice(0, remaining) };
        remaining -= result.text.length;
        return result;
      })
      .filter(({ text }) => text.trim() && !unsafeMemory(text));
    const key = join(directory, '.' + jobId + '.extraction.json');
    const save = async (result: MemoryExtraction) => {
      assertOwned();
      result.updatedAt = new Date().toISOString();
      await writeJSON(key, result);
      await writeJSON(join(directory, '.extraction-state.json'), result);
      changed();
      return result;
    };
    try {
      const file = await open(key, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await file.stat()).size > 8192) throw new Error('Invalid memory extraction record.');
        const previous: MemoryExtraction = JSON.parse(await file.readFile('utf8'));
        if (previous.id === jobId && ['saved', 'skipped'].includes(previous.status))
          return previous;
      } finally {
        await file.close();
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    const base = {
      id: jobId,
      turnId: scope.turnId,
      runtimeId: memoryRuntimeId,
      updatedAt: new Date().toISOString(),
    };
    await save({ ...base, status: 'queued' });
    const work = tail
      .catch(() => {})
      .then(async (): Promise<MemoryExtraction> => {
        let count = 0;
        try {
          signal.throwIfAborted();
          if (!sources.length) return save({ ...base, status: 'skipped', saved: 0 });
          await save({ ...base, status: 'extracting' });
          const text = await extract(JSON.stringify(sources), signal);
          signal.throwIfAborted();
          if (text.length > extractionLimits.output)
            throw new Error('Extraction output exceeded its limit.');
          const candidates: MemoryCandidate[] = JSON.parse(text);
          if (!Array.isArray(candidates) || candidates.length > extractionLimits.candidates)
            throw new Error('Invalid extraction candidate count.');
          await save({ ...base, status: 'validating' });
          const memory = new ManagedMemory({ ...scope, sources: () => sources }, changed);
          for (const candidate of candidates) {
            assertOwned();
            signal.throwIfAborted();
            // Background work can propose new facts, never silently rewrite an existing decision.
            if (candidate.id || candidate.expectedRevision || candidate.supersedes?.length)
              continue;
            const result = await memory.upsert(candidate);
            if (result.status === 'saved' || result.status === 'duplicate') count++;
          }
          return save({ ...base, status: count ? 'saved' : 'skipped', saved: count });
        } catch {
          // Provider errors can contain private prompt text. Persist only a safe failure category.
          return save({
            ...base,
            status: 'failed',
            saved: count,
            error: signal.aborted
              ? 'Extraction canceled. It can be retried after the next completed turn.'
              : 'Memory extraction failed. The conversation was not changed.',
          });
        }
      });
    tail = work;
    return work;
  }
}
