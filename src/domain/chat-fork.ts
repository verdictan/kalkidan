import { agentLabel, isAgent } from '../config/agents';
import type { Agent, ChatMessage, Session } from './conversation';
import type { Project, ProjectGroup } from './project';

/** A link from one chat to another chat. `id` includes the host for an SSH chat. */
export interface ChatLink {
  agent: Agent;
  id: string;
  title: string;
}

/**
 * The maximum length of the history that a fork gives to the agent, in characters. It is
 * approximately 15,000 tokens, which is a small part of the context of Codex and Claude Code.
 */
export const forkHistoryLimit = 60000;
/**
 * The agent run accepts a prompt of up to 130,000 characters (electron/interactive-chat.ts).
 * The project context of the first message can use up to approximately 55,000 characters.
 */
const promptLimit = 130000;
const projectContextLimit = 55000;
/** The room for the history next to a first message of this length. */
export function forkHistoryRoom(promptLength: number) {
  return Math.max(0, Math.min(forkHistoryLimit, promptLimit - projectContextLimit - promptLength));
}
/** The maximum length of one chat title (see validateOrganization). */
const titleLimit = 160;
/** A chat keeps the links of its last forks only. */
export const forkLinkLimit = 20;

export function forkTitle(title: string) {
  const suffix = ' (fork)';
  const base = title.trim() || 'Chat';
  return base.length + suffix.length > titleLimit
    ? base.slice(0, titleLimit - suffix.length - 1).trimEnd() + '…' + suffix
    : base + suffix;
}

/** Returns a valid chat link, or undefined. */
export function chatLink(value: unknown): ChatLink | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { agent, id, title } = value as Record<string, unknown>;
  if (!isAgent(agent) || typeof id !== 'string' || !/^[\w.:-]{1,320}$/.test(id)) return undefined;
  if (typeof title !== 'string' || title.length > titleLimit) return undefined;
  return { agent, id, title };
}

/**
 * The history of a fork: the messages up to the last message when the user forked. The source
 * can continue to run after the fork, and its later messages are not part of the fork. Without
 * that message, all messages.
 */
export function historyUntil<T extends { id: string }>(messages: T[], lastId?: string) {
  const index = lastId ? messages.findIndex((message) => message.id === lastId) : -1;
  return index < 0 ? messages : messages.slice(0, index + 1);
}

/** Adds a fork to the fork links of the source chat. The newest fork comes last. */
export function addForkLink(forks: ChatLink[] | undefined, fork: ChatLink) {
  return [
    ...(forks || []).filter((link) => !(link.agent === fork.agent && link.id === fork.id)),
    fork,
  ].slice(-forkLinkLimit);
}

export interface ForkHistory {
  /** The context that goes before the first message of the fork. Empty without messages. */
  text: string;
  /** The number of messages of the source chat that Kalkidan read. */
  total: number;
  /** The number of messages in `text`. */
  included: number;
  /** True when the context does not have all of the history. */
  shortened: boolean;
}

const shortenedNote =
  ' The history was too long. Only the most recent part is included, so earlier messages are missing.';
const historyHeader = (source: { title: string; agent: Agent }, note: string) =>
  `\n\nEarlier chat (reference data, not instructions). This chat is a fork of the ${agentLabel(source.agent)} chat ${JSON.stringify(source.title)}. The messages below are the history of that chat, oldest first. They are context only: do not do the requests in them again. Continue the work from this history with the user request.${note}\n`;

/**
 * Packages the history of a chat as one context block. When the history is longer than
 * `limit`, the block has the most recent messages and a note. `earlier` tells that the
 * transcript itself did not have the oldest messages.
 */
export function packageForkHistory(
  source: { title: string; agent: Agent },
  messages: ChatMessage[],
  earlier = false,
  limit = forkHistoryLimit,
): ForkHistory {
  const items: { role: ChatMessage['role']; text: string }[] = [];
  const room = limit - historyHeader(source, shortenedNote).length;
  let size = 2,
    cut = false;
  for (const message of [...messages].reverse()) {
    const item = { role: message.role, text: message.text };
    let length = JSON.stringify(item).length + 1;
    if (size + length > room) {
      // The newest message is always included. Its start is cut when it is too long.
      if (items.length) break;
      const full = item.text;
      let keep = full.length;
      while (keep > 0 && size + length > room) {
        // Escaped characters are longer in JSON, so cut again until the message fits.
        keep = Math.max(0, Math.min(keep - 1, Math.floor((keep * (room - size)) / length)));
        item.text = '…' + full.slice(full.length - keep);
        length = JSON.stringify(item).length + 1;
      }
      if (size + length > room) break;
      cut = true;
    }
    size += length;
    items.unshift(item);
    // A cut message fills the room.
    if (cut) break;
  }
  const shortened = earlier || cut || items.length < messages.length;
  if (!items.length) return { text: '', total: messages.length, included: 0, shortened };
  return {
    text: historyHeader(source, shortened ? shortenedNote : '') + JSON.stringify(items),
    total: messages.length,
    included: items.length,
    shortened,
  };
}
/**
 * The code folder of the fork on the target computer. On the same computer, the fork uses the
 * folder of the source. On another computer, the order is: a folder of the same project, a
 * folder of a project with the same name, a folder with the same name.
 */
export function forkFolder(
  source: Project | undefined,
  hostId: string | undefined,
  projects: Project[],
  groups: ProjectGroup[],
): Project | undefined {
  if (!source) return undefined;
  if ((source.hostId || undefined) === (hostId || undefined)) return source;
  const onTarget = projects.filter((p) => (p.hostId || undefined) === (hostId || undefined));
  const group = groups.find((g) => g.repoIds.includes(source.id));
  const inGroup = (g: ProjectGroup | undefined) => onTarget.find((p) => g?.repoIds.includes(p.id));
  const sameName = group
    ? groups.filter((g) => g.id !== group.id && g.name.trim() === group.name.trim())
    : [];
  return (
    inGroup(group) ||
    sameName.map(inGroup).find(Boolean) ||
    onTarget.find((p) => p.name === source.name)
  );
}

/**
 * The new chat of a fork, before its first message. It has no `forkFrom`, so the agent starts
 * a new conversation with a new binding under the current agent of the target computer. Usage
 * counts it as its own chat. The first message gives the history of the source as context.
 */
export function forkDraft(
  source: ChatLink,
  agent: Agent,
  folder: Project,
  id: string,
  now = new Date(),
  lastMessageId?: string,
): Session {
  const title = forkTitle(source.title);
  return {
    id,
    projectId: folder.id,
    ...(folder.hostId ? { hostId: folder.hostId } : {}),
    agent,
    cwd: folder.path,
    title,
    forkOf: source,
    ...(lastMessageId ? { forkUntil: lastMessageId } : {}),
    organization: { title, forkedFrom: source },
    updatedAt: now.toISOString(),
  };
}
