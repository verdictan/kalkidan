import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAgentVersion, type NativeAgentKind } from '../../src/domain/agent-version';

const exec = promisify(execFile);

export interface AgentExecutable {
  path: string;
  env: NodeJS.ProcessEnv;
  args?: string[];
}
export type InstalledAgentVersion = (
  kind: NativeAgentKind,
  executable: AgentExecutable,
  signal?: AbortSignal,
) => Promise<string | undefined>;

/**
 * Reads the version of an installed native agent from `--version`. Returns undefined when the
 * agent does not start or prints an unknown format. A canceled read stops with the abort error.
 */
export const installedAgentVersion: InstalledAgentVersion = async (kind, executable, signal) => {
  try {
    const { stdout } = await exec(executable.path, [...(executable.args || []), '--version'], {
      env: executable.env,
      timeout: 10000,
      maxBuffer: 8192,
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    return parseAgentVersion(stdout, kind);
  } catch (error) {
    signal?.throwIfAborted();
    void error;
    return undefined;
  }
};
