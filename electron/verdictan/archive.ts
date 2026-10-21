import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { extract } from 'tar';
import { openPromise } from 'yauzl';
import type { RuntimeArtifact } from './release';

/** Extract only executables and notices from the platform packaging contract. */
export async function extractRuntime(
  archive: string,
  destination: string,
  artifact: RuntimeArtifact,
) {
  const executable = artifact.os === 'win32' ? 'verdictan.exe' : 'verdictan';
  const updater = artifact.os === 'win32' ? 'verdictan-update.exe' : 'verdictan-update';
  const files = new Set([executable, updater, 'THIRD_PARTY_NOTICES.md']);
  const optional = new Set(['KALKIDAN_REDISTRIBUTION.md']);
  const seen = new Set<string>();
  let total = 0;
  function check(name: string, size: number) {
    if (
      (!files.has(name) && !optional.has(name)) ||
      seen.has(name) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      (total += size) > 1024 * 1024 * 1024
    )
      throw new Error('The runtime archive contains unexpected or oversized files.');
    seen.add(name);
  }
  if (artifact.os === 'win32') {
    const zip = await openPromise(archive, {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    try {
      for await (const entry of zip.eachEntry()) {
        const type = (entry.externalFileAttributes >>> 16) & 0xf000;
        if ((type && type !== 0x8000) || entry.isEncrypted())
          throw new Error('Runtime archives cannot contain links or encrypted files.');
        check(entry.fileName, entry.uncompressedSize);
        const stream = await zip.openReadStreamPromise(entry);
        await pipeline(
          stream,
          createWriteStream(join(destination, entry.fileName), { flags: 'wx', mode: 0o600 }),
        );
      }
    } finally {
      zip.close();
    }
  } else {
    let rejected: Error | undefined;
    await extract({
      file: archive,
      cwd: destination,
      strip: 1,
      strict: true,
      noChmod: true,
      maxDepth: 2,
      maxDecompressionRatio: 100,
      filter: (path, entry) => {
        try {
          const parts = path.split('/');
          if (
            parts.length !== 2 ||
            parts[0] !== `verdictan-${artifact.target}` ||
            !('type' in entry) ||
            entry.type !== 'File'
          )
            throw new Error('Runtime archives cannot contain links or unexpected paths.');
          check(parts[1], entry.size);
          return true;
        } catch (error) {
          rejected = error as Error;
          return false;
        }
      },
    });
    if (rejected) throw rejected;
  }
  if ([...files].some((name) => !seen.has(name)))
    throw new Error('The runtime archive is incomplete.');
  for (const name of seen) {
    if (!(await lstat(join(destination, name))).isFile())
      throw new Error('The extracted runtime contains a non-file entry.');
    await chmod(join(destination, name), name.endsWith('.md') ? 0o600 : 0o700);
  }
  const path = join(destination, executable);
  if (artifact.executable_sha256 !== undefined) {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    if (hash.digest('hex') !== artifact.executable_sha256)
      throw new Error('The runtime executable checksum failed.');
  }
  return path;
}
