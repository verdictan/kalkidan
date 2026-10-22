import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { releaseNetworkError } from './network';
import { releaseURL, type InstallArtifact } from './release';

/** Send a GET request. Follow at most 5 redirects, and only to approved HTTPS origins. */
async function requestRelease(
  value: string,
  approvedOrigins: string[],
  signal: AbortSignal,
  request: typeof fetch,
) {
  let url = releaseURL(value);
  const origins = new Set(approvedOrigins);
  if (!origins.has(url.origin)) throw new Error('The release download origin is not approved.');
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    try {
      response = await request(url, {
        redirect: 'manual',
        signal,
        headers: { 'Accept-Encoding': 'identity' },
      });
    } catch (error) {
      throw releaseNetworkError(error) ?? error;
    }
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
  return response as Response & { body: ReadableStream<Uint8Array> };
}

/** Read the next part of a response. A lost connection gets plain words. */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    return await reader.read();
  } catch (error) {
    throw releaseNetworkError(error) ?? error;
  }
}

/** Download a small release file, such as a manifest or a signature, into memory. */
export async function downloadReleaseFile(
  url: string,
  approvedOrigins: string[],
  limit: number,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const response = await requestRelease(url, approvedOrigins, signal, request);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await readChunk(reader);
      if (done) break;
      received += value.byteLength;
      if (received > limit) throw new Error('The release file exceeds its size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

/** Read the size of a release file from its response headers, without the file body. */
export async function releaseFileSize(
  url: string,
  approvedOrigins: string[],
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const response = await requestRelease(url, approvedOrigins, signal, request);
  await response.body.cancel().catch(() => {});
  const size = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > 512 * 1024 * 1024)
    throw new Error('The release file size is not known.');
  return size;
}

export async function downloadRuntime(
  artifact: InstallArtifact,
  file: string,
  approvedOrigins: string[],
  signal: AbortSignal,
  progress: (bytes: number) => void,
  request: typeof fetch = fetch,
) {
  const response = await requestRelease(artifact.url, approvedOrigins, signal, request);
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== artifact.size) {
    await response.body.cancel();
    throw new Error('The runtime download size does not match the published release.');
  }
  const reader = response.body.getReader();
  let output;
  const checksum = createHash('sha256');
  let received = 0;
  try {
    output = await open(file, 'wx', 0o600);
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await readChunk(reader);
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

/**
 * Check the size and the SHA-256 digest of a runtime archive that came from another computer, for
 * example a copy over SSH. The signature check comes after this check.
 */
export async function verifyRuntimeArchive(artifact: InstallArtifact, file: string) {
  const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size !== artifact.size)
      throw new Error('The copied runtime size does not match the published release.');
    const checksum = createHash('sha256');
    for await (const bytes of input.createReadStream({ autoClose: false })) checksum.update(bytes);
    if (checksum.digest('hex') !== artifact.sha256)
      throw new Error('The copied runtime checksum failed.');
  } finally {
    await input.close();
  }
}
