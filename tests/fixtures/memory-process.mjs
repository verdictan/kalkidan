import { ManagedMemory } from '../../electron/storage/managed-memory.ts';
import { extractMemory } from '../../electron/storage/memory-extraction.ts';

let release;
process.on('message', async (command) => {
  if (command.kind === 'release') {
    release?.();
    return;
  }
  if (command.kind !== 'run') return;
  const scope = {
    root: command.root,
    sessionId: 'shared-session',
    turnId: command.turnId || 'shared-turn',
    sources: () => [
      { id: 'user', text: 'Use npm test.\nUse npm run build.\nUse the main branch.' },
    ],
  };
  process.send({ kind: 'started' });
  try {
    const candidate = {
      topic: 'Tests',
      content: command.content || 'Use npm test.',
      references: [{ id: 'user', quote: command.content || 'Use npm test.' }],
      ...(command.entryId ? { id: command.entryId, expectedRevision: command.revision } : {}),
    };
    const result =
      command.operation === 'extract'
        ? await extractMemory(
            scope,
            async () => {
              const gate = new Promise((resolve) => {
                release = resolve;
              });
              process.send({ kind: 'extracting' });
              await gate;
              return JSON.stringify([candidate]);
            },
            new AbortController().signal,
          )
        : await new ManagedMemory(scope).upsert(candidate);
    process.send({ kind: 'result', result });
  } catch (error) {
    process.send({ kind: 'error', message: error.message });
  }
});
process.send({ kind: 'ready' });
