import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const exec = promisify(execFile);
export function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
/**
 * Opens a plain shell in a project folder. Agents never start here: Kalkidan runs agents only
 * through managed Verdictan agents, so there is no command that starts a local agent CLI.
 */
export function launchCommand(path: string, agent: 'terminal') {
  if (agent !== 'terminal') throw new Error('Agent sessions must be opened inside Kalkidan.');
  return `cd -- ${shellQuote(path)}`;
}
export function parseWorktrees(output: string) {
  return output
    .split('\n\n')
    .filter(Boolean)
    .flatMap((block) => {
      const lines = block.split('\n');
      const path = lines.find((l) => l.startsWith('worktree '))?.slice(9);
      return path
        ? [
            {
              path,
              branch:
                lines
                  .find((l) => l.startsWith('branch '))
                  ?.slice(7)
                  .replace('refs/heads/', '') || 'detached',
            },
          ]
        : [];
    });
}
