import {
  releaseAssetURL,
  runtimeArchiveName,
  runtimeTarget,
  type RuntimeDiscovery,
} from '../verdictan/release';
/**
 * Find the newest stable release that has an archive for this host. Discovery is not trust. The
 * installer accepts the release only when the Verdictan release key signs it.
 */
export async function discoverRuntime(
  os: string,
  arch: string,
  request: typeof fetch = fetch,
): Promise<RuntimeDiscovery | undefined> {
  const target = runtimeTarget(os, arch);
  if (!target) return undefined;
  const name = runtimeArchiveName(target);
  const signal = AbortSignal.timeout(15000);
  for (let page = 1; page <= 5; page++) {
    const response = await request(
      `https://api.github.com/repos/verdictan/packages/releases?per_page=100&page=${page}`,
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
    if (!Array.isArray(records) || records.length > 100)
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
    if (records.length < 100) break;
  }
  throw new Error('No compatible runtime release was found within the release history limit.');
}
