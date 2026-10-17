import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const exec = promisify(execFile);
export function shellQuote(value: string) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
export function launchCommand(path: string, agent: 'codex' | 'claude' | 'terminal', sessionId?: string) {
  if (!['codex', 'claude', 'terminal'].includes(agent)) throw new Error('Unknown agent');
  if (sessionId && !/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) throw new Error('Invalid session ID');
  const command = agent === 'terminal' ? '' : ` && ${agent}${sessionId ? (agent === 'codex' ? ' resume ' : ' --resume ') + shellQuote(sessionId) : ''}`;
  return `cd -- ${shellQuote(path)}${command}`;
}
export function parseWorktrees(output: string) {
  return output.split('\n\n').filter(Boolean).flatMap(block => {
    const lines = block.split('\n'); const path = lines.find(l => l.startsWith('worktree '))?.slice(9);
    return path ? [{ path, branch: lines.find(l => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '') || 'detached' }] : [];
  });
}
