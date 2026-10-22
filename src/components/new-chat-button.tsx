import { useEffect, useState } from 'react';
import { ChevronDown, FolderGit2, Monitor, Plus } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import {
  agentInstalled,
  agentMenuLabel,
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from '../lib/agent-preference';
import { sessionRepo } from '../lib/session-repository';
import { shortcutLabel } from '../lib/platform';
import type { Agent, Project, Session } from '../types';
import { Hint } from './hint';
import { MenuChoiceItem } from './action-menu';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

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

/**
 * The one "New chat" button: the main part starts a chat with the preferred agent in the last
 * used code folder. The menu sets the agent first, then starts in a code folder.
 */
export function NewChatButton({
  repos,
  sessions = [],
  groupId,
  preferredRepoId,
  variant = 'default',
  size = 'default',
}: {
  /** The code folders that the chat can start in. */
  repos: Project[];
  /** The chats of these code folders. The most recent one sets the default code folder. */
  sessions?: Session[];
  /** The project. Without code folders, the shell offers to add one to it. */
  groupId?: string;
  preferredRepoId?: string;
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
}) {
  const agent = usePreferredAgent();
  const target = recentRepo(repos, sessions, preferredRepoId);
  const missing = agentCatalog.some(({ id }) => !agentInstalled(id));
  const start = (repo: Project | null, chosen: Agent = agent) =>
    requestNewChat({ groupId, repoId: repo?.id, agent: chosen });
  const divider =
    variant === 'default' ? 'border-l border-primary-foreground/20' : 'border-l-0 -ml-px';
  return (
    <div className="split-button" role="group" aria-label="New chat">
      <Hint
        label={target ? `${agentLabel(agent)} in ${target.name}` : 'Add code folder first'}
        shortcut={target ? shortcutLabel(['mod'], 'N') : undefined}
      >
        <Button
          variant={variant}
          size={size}
          className="rounded-r-none"
          aria-label="New chat"
          onClick={() => start(target)}
        >
          <Plus />
          New chat
        </Button>
      </Hint>
      <DropdownMenu>
        <Hint label="Choose an agent and a code folder">
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              size={size === 'sm' ? 'icon-sm' : 'icon'}
              className={'rounded-l-none ' + divider}
              aria-label="Choose an agent and a code folder"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" width="wide">
          <DropdownMenuLabel>Agent</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={agent}
            onValueChange={(value) => {
              const next = agentCatalog.find((item) => item.id === value)?.id;
              if (next && agentInstalled(next)) savePreferredAgent(next);
            }}
          >
            {agentCatalog.map(({ id }) => (
              <MenuChoiceItem
                key={id}
                value={id}
                disabled={!agentInstalled(id)}
                // The menu stays open, so the user can choose a code folder next.
                onSelect={(event) => event.preventDefault()}
              >
                <AgentIcon agent={id} />
                {agentMenuLabel(id, agentLabel(id))}
              </MenuChoiceItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Start in</DropdownMenuLabel>
          {repos.length ? (
            repos.map((repo) => (
              <DropdownMenuItem key={repo.id} onSelect={() => start(repo)}>
                <FolderGit2 />
                {repo.name}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem onSelect={() => start(null)}>
              <FolderGit2 />
              Add code folder…
            </DropdownMenuItem>
          )}
          {missing && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  window.dispatchEvent(new CustomEvent('kalkidan-open-computers', { detail: {} }))
                }
              >
                <Monitor />
                Install agents…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
