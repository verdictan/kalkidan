import { execFile } from 'node:child_process';
import { DesktopProtocolError } from './protocol';

/** The version that `verdictan --version` prints, for example `verdictan 0.6.10`. */
export function runtimeVersionOutput(executable: string, run = execFile) {
  return new Promise<string>((resolve, reject) => {
    run(
      executable,
      ['--version'],
      {
        timeout: 15000,
        maxBuffer: 4096,
        windowsHide: true,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !/^(?:VERDICTAN_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/i.test(key),
          ),
        ),
      },
      (error, stdout) => {
        const match = /^verdictan (\d{1,8}\.\d{1,8}\.\d{1,8})\r?\n?$/.exec(String(stdout));
        if (error || !match) reject(new Error('Runtime executable did not report its version.'));
        else resolve(match[1]);
      },
    );
  });
}

/**
 * Check that a runtime executable starts and reports the version of its signed release.
 *
 * The protocol check comes first. Verdictan CLI 0.6.10 and earlier read the account store for
 * `capabilities`. A Linux host without a system keyring, for example a headless server, cannot
 * give that access. On such a host, the version output is the check. The installer already
 * verified the digest of the executable against the signed release.
 */
export async function probeRuntime(
  executable: string,
  version: string,
  options: {
    capabilities(): Promise<{ cliVersion: string }>;
    versionOutput?(executable: string): Promise<string>;
    platform?: string;
  },
) {
  let reported: string;
  try {
    reported = (await options.capabilities()).cliVersion;
  } catch (error) {
    if (
      !(error instanceof DesktopProtocolError) ||
      error.code !== 'desktop.secure_storage_unavailable' ||
      (options.platform ?? process.platform) !== 'linux'
    )
      throw error;
    reported = await (options.versionOutput ?? runtimeVersionOutput)(executable);
  }
  if (reported !== version)
    throw new Error('Runtime executable version does not match the signed release.');
}
