import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { releaseURL, type RuntimeArtifact } from './release';

export async function downloadRuntime(
  artifact: RuntimeArtifact,
  file: string,
  approvedOrigins: string[],
  signal: AbortSignal,
  progress: (bytes: number) => void,
  request: typeof fetch = fetch,
) {
  let url = releaseURL(artifact.url);
  const origins = new Set(approvedOrigins);
  if (!origins.has(url.origin)) throw new Error('The release download origin is not approved.');
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await request(url, {
      redirect: 'manual',
      signal,
      headers: { 'Accept-Encoding': 'identity' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location || redirects === 5)
      throw new Error('The runtime download redirected too many times.');
    url = new URL(location, url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      !origins.has(url.origin)
    )
      throw new Error('The runtime download redirected to an unapproved origin.');
  }
  if (!response?.ok || !response.body) {
    await response?.body?.cancel();
    throw new Error('The runtime download is unavailable. Retry later.');
  }
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== artifact.size) {
    await response.body.cancel();
    throw new Error('The runtime download size does not match reviewed metadata.');
  }
  const reader = response.body.getReader();
  let output;
  const checksum = createHash('sha256');
  let received = 0;
  try {
    output = await open(file, 'wx', 0o600);
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > artifact.size) throw new Error('The runtime download exceeds its size limit.');
      checksum.update(value);
      // FileHandle.write can write fewer bytes than requested.
      let offset = 0;
      while (offset < value.length) {
        const { bytesWritten } = await output.write(value, offset, value.length - offset);
        if (!bytesWritten) throw new Error('The runtime download could not be written.');
        offset += bytesWritten;
      }
      progress(received);
    }
    if (received !== artifact.size || checksum.digest('hex') !== artifact.sha256)
      throw new Error('The runtime download checksum failed.');
    await output.sync();
  } finally {
    await reader.cancel().catch(() => {});
    await output?.close();
  }
}
