import type { ComponentRelease } from '../../src/domain/updates';
/** Public release metadata is discovery only. Approval stays in the bundled/operator policy. */
export async function discoverRuntime(
  os: string,
  arch: string,
  request: typeof fetch = fetch,
): Promise<ComponentRelease | undefined> {
  const target = (
    { 'darwin-arm64': 'aarch64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-gnu' } as Record<
      string,
      string
    >
  )[`${os}-${arch}`];
  if (!target) return undefined;
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
        Array.isArray(row.assets) &&
        row.assets.find((asset: any) => asset.name === `verdictan-${target}.tar.gz`);
      if (!asset) continue;
      if (
        !Number.isSafeInteger(row.id) ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        asset.browser_download_url !==
          `https://github.com/verdictan/packages/releases/download/${row.tag_name}/verdictan-${target}.tar.gz`
      )
        throw new Error('Runtime release identity is incomplete.');
      return {
        version: row.tag_name.slice(1),
        releaseId: String(row.id),
        sha256: asset.digest.slice(7),
      };
    }
    if (records.length < 100) break;
  }
  throw new Error('No compatible runtime release was found within the release history limit.');
}
