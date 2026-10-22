import { downloadReleaseFile, releaseFileSize } from '../verdictan/download';
import {
  releaseAssetURL,
  releaseDownloadOrigins,
  runtimeArchiveName,
  runtimeTarget,
  type RuntimeDiscovery,
} from '../verdictan/release';
/**
 * Find the newest stable release that has an archive for this host. Discovery is not trust. The
 * installer accepts the release only when the Verdictan release key signs it.
 *
 * The latest-release redirect on github.com comes first, because the GitHub REST API allows only
 * 60 unauthenticated requests each hour for each IP address. The API is the fallback, for example
 * when the latest release is not a Verdictan CLI release.
 */
export async function discoverRuntime(
  os: string,
  arch: string,
  request: typeof fetch = fetch,
): Promise<RuntimeDiscovery | undefined> {
  const target = runtimeTarget(os, arch);
  if (!target) return undefined;
  const name = runtimeArchiveName(target);
  try {
    const latest = await discoverLatest(name, request);
    if (latest) return latest;
  } catch {
    // Use the API below.
  }
  return discoverFromAPI(name, request);
}

const latestReleaseURL = 'https://github.com/verdictan/packages/releases/latest';

/** Read the latest tag from the github.com redirect, then the archive digest from `sha256.sum`. */
async function discoverLatest(
  name: string,
  request: typeof fetch,
): Promise<RuntimeDiscovery | undefined> {
  const signal = AbortSignal.timeout(15000);
  const response = await request(latestReleaseURL, { redirect: 'manual', signal });
  await response.body?.cancel();
  const location = response.headers.get('location');
  if (![301, 302, 303, 307, 308].includes(response.status) || !location) return undefined;
  const tag = new URL(location, latestReleaseURL);
  const match = /^\/verdictan\/packages\/releases\/tag\/v(\d{1,8}\.\d{1,8}\.\d{1,8})$/.exec(
    tag.pathname,
  );
  if (tag.origin !== 'https://github.com' || tag.search || tag.hash || !match) return undefined;
  const version = match[1];
  const sums = await downloadReleaseFile(
    releaseAssetURL(version, 'sha256.sum'),
    releaseDownloadOrigins,
    65536,
    signal,
    request,
  );
  const line = sums
    .toString('utf8')
    .split('\n')
    .map((row) => /^([a-f0-9]{64}) [ *]?(\S+)$/.exec(row.trim()))
    .find((row) => row?.[2] === name);
  if (!line) return undefined;
  const size = await releaseFileSize(
    releaseAssetURL(version, name),
    releaseDownloadOrigins,
    signal,
    request,
  );
  return { version, releaseId: `tag:v${version}`, sha256: line[1], size };
}

/**
 * Each release lists about 90 assets, so 100 releases are more than 4 MiB. A page of 30 releases
 * is about 2.5 MiB. Kalkidan reads at most 300 releases.
 */
const releasesPerPage = 30;

async function discoverFromAPI(name: string, request: typeof fetch): Promise<RuntimeDiscovery> {
  const signal = AbortSignal.timeout(30000);
  for (let page = 1; page <= 10; page++) {
    const response = await request(
      `https://api.github.com/repos/verdictan/packages/releases?per_page=${releasesPerPage}&page=${page}`,
      {
        signal,
        redirect: 'error',
        headers: { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
      },
    );
    if (!response.ok || !response.body)
      throw new Error('Runtime release discovery is unavailable.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error('Runtime release metadata exceeds its limit.');
      chunks.push(chunk);
    }
    const records = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(records) || records.length > releasesPerPage)
      throw new Error('Invalid runtime release metadata.');
    for (const row of records) {
      if (
        row.draft ||
        row.prerelease ||
        typeof row.tag_name !== 'string' ||
        !/^v\d+\.\d+\.\d+$/.test(row.tag_name)
      )
        continue;
      const asset =
        Array.isArray(row.assets) && row.assets.find((asset: any) => asset.name === name);
      if (!asset) continue;
      if (
        !Number.isSafeInteger(row.id) ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size < 1 ||
        asset.size > 512 * 1024 * 1024 ||
        asset.browser_download_url !== releaseAssetURL(row.tag_name.slice(1), name)
      )
        throw new Error('Runtime release identity is incomplete.');
      return {
        version: row.tag_name.slice(1),
        releaseId: String(row.id),
        sha256: asset.digest.slice(7),
        size: asset.size,
      };
    }
    if (records.length < releasesPerPage) break;
  }
  throw new Error('No compatible runtime release was found within the release history limit.');
}
