import { useEffect, useState } from 'react';
import { onPreferredAgentChange, readPreferredAgent } from '../lib/agent-preference';
import { sessionRepo } from '../lib/session-repository';
import type { Agent, Project, Session } from '../types';

// There is one way to start a chat: ⌘N, New chat in the sidebar, or the composer on Overview.
// The "New chat" split buttons in the page headers are gone. These helpers stay for them.

/** The agent that new chats use. It follows the preference that every "New chat" menu sets. */
export function usePreferredAgent(): Agent {
  const [agent, setAgent] = useState<Agent>(readPreferredAgent);
  useEffect(() => onPreferredAgentChange(setAgent), []);
  return agent;
}

/** The code folder of the most recent chat in `repos`, else the first code folder. */
export function recentRepo(repos: Project[], sessions: Session[], preferredId?: string) {
  const preferred = repos.find((repo) => repo.id === preferredId);
  if (preferred) return preferred;
  const latest = sessions
    .filter((s) => !s.organization?.archived && !s.id.startsWith('draft-'))
    .map((session) => ({ session, repo: sessionRepo(session, repos) }))
    .filter((item) => !!item.repo)
    .sort((a, b) => (b.session.updatedAt || '').localeCompare(a.session.updatedAt || ''))[0];
  return latest?.repo || repos[0] || null;
}

/**
 * Asks the shell for a new chat. Without a code folder, the shell asks the user to add one.
 * The agent is the preferred agent when `agent` is not set.
 */
export function requestNewChat(detail: {
  groupId?: string;
  repoId?: string;
  agent?: Agent;
  /** The first message. */
  prompt?: string;
  /** Sends `prompt` at once, as the first message of the chat. */
  send?: boolean;
}) {
  window.dispatchEvent(new CustomEvent('kalkidan-new-session', { detail }));
}
