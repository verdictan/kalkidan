import lockfile from 'proper-lockfile';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';

/** A renewable filesystem lease coordinates independent desktop/helper processes. */
export async function withDirectoryLock<T>(
  directory: string,
  action: (assertOwned: () => void) => Promise<T>,
  key?: string,
): Promise<T> {
  if (key !== undefined && !/^[a-f0-9]{64}$/.test(key))
    throw new Error('Invalid storage lock key.');
  let compromised = false;
  const target = key ? join(await realpath(directory), '.' + key) : directory;
  const release = await lockfile.lock(target, {
    realpath: key === undefined,
    stale: 30000,
    update: 5000,
    retries: { retries: 20, factor: 1, minTimeout: 100, maxTimeout: 100, randomize: false },
    onCompromised: () => {
      compromised = true;
    },
  });
  const assertOwned = () => {
    if (compromised) throw new Error('Storage ownership was lost. Reload before retrying.');
  };
  try {
    assertOwned();
    return await action(assertOwned);
  } finally {
    if (!compromised) await release();
  }
}
