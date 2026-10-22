// The question when the user quits Kalkidan while agent runs or shells work on SSH hosts.
// That work continues on the hosts without the app. The user can keep it or stop all of it.

/** One agent run or one shell that works on an SSH host. */
export interface SshWorkItem {
  id: string;
  label: string;
}

/** The work on one SSH host. */
export interface SshHostWork {
  hostId: string;
  hostName: string;
  runs: SshWorkItem[];
  shells: SshWorkItem[];
}

/** The main process asks a window. The window answers with the same ID. */
export interface SshQuitRequest {
  id: string;
  hosts: SshHostWork[];
}

/** "Keep running" leaves the work on the hosts. "Stop all" stops it, then the app quits. */
export type SshQuitChoice = 'keep' | 'stop';

export interface SshQuitAnswer {
  id: string;
  choice: SshQuitChoice;
  /** True when the user does not want this question again. Settings can turn it on again. */
  dontAsk: boolean;
}

/** True when there is work to ask about. */
export function hasSshWork(hosts: SshHostWork[]) {
  return hosts.some((host) => host.runs.length + host.shells.length > 0);
}

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

/** The work in words, for example "2 agent runs and 1 shell on 1 SSH host". */
export function sshWorkSummary(hosts: SshHostWork[]) {
  const busy = hosts.filter((host) => host.runs.length + host.shells.length > 0);
  const runs = busy.reduce((total, host) => total + host.runs.length, 0);
  const shells = busy.reduce((total, host) => total + host.shells.length, 0);
  const parts = [
    ...(runs ? [count(runs, 'agent run')] : []),
    ...(shells ? [count(shells, 'shell')] : []),
  ];
  return `${parts.join(' and ')} on ${count(busy.length, 'SSH host')}`;
}

/** Reads an answer from a window. A value that is not valid gives null. */
export function parseSshQuitAnswer(value: unknown): SshQuitAnswer | null {
  const answer = value as SshQuitAnswer;
  if (
    !answer ||
    typeof answer !== 'object' ||
    typeof answer.id !== 'string' ||
    !answer.id ||
    answer.id.length > 100 ||
    (answer.choice !== 'keep' && answer.choice !== 'stop') ||
    typeof answer.dontAsk !== 'boolean'
  )
    return null;
  return { id: answer.id, choice: answer.choice, dontAsk: answer.dontAsk };
}
