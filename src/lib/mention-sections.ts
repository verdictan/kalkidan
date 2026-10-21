import {
  chatMentionId,
  fileScore,
  fuzzyScore,
  mentionToken,
  type MentionKind,
} from '../domain/mentions';
import type { MemoryEntry } from '../domain/memory';
import { agentLabel } from '../config/agents';
import type { TrackerItem } from '../domain/tracker';

/** The state of one source of the "@" picker. */
export type MentionSource<T> =
  | { status: 'loading' }
  | { status: 'ready'; items: T[]; note?: string }
  | { status: 'error'; message: string }
  /** The source is not available for this project, for example tasks without a board. */
  | { status: 'none'; message: string };

/** Another chat of the project that the user can mention. */
export interface MentionChat {
  id: string;
  agent: string;
  title: string;
  updatedAt?: string;
}

export interface MentionOption {
  key: string;
  kind: MentionKind | 'search';
  label: string;
  detail?: string;
  /** The text that replaces the "@" word. */
  insert: string;
}
export interface MentionSection {
  kind: MentionKind | 'search';
  title: string;
  options: MentionOption[];
  /** The empty state, the load state or a note. */
  message?: string;
}

export interface MentionSourceSet {
  files: MentionSource<string>;
  docs: MentionSource<{ id: string; title: string }>;
  tasks: MentionSource<TrackerItem>;
  memory: MentionSource<MemoryEntry>;
  chats: MentionChat[];
}

function ranked<T>(
  query: string,
  items: T[],
  score: (item: T) => number | null,
  limit: number,
): T[] {
  if (!query) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function section<T>(
  kind: MentionKind,
  title: string,
  source: MentionSource<T>,
  query: string,
  limit: number,
  score: (item: T) => number | null,
  option: (item: T) => Pick<MentionOption, 'label' | 'detail'> & { id: string },
  empty: { none: string; noMatch: string },
): MentionSection {
  if (source.status === 'loading') return { kind, title, options: [], message: 'Loading…' };
  if (source.status === 'error' || source.status === 'none')
    return { kind, title, options: [], message: source.message };
  const options = ranked(query, source.items, score, limit).map((item) => {
    const { id, ...rest } = option(item);
    return {
      ...rest,
      kind,
      key: `${kind}:${id}`,
      insert: mentionToken({ kind, id, label: rest.label }),
    };
  });
  const message = !source.items.length ? empty.none : !options.length ? empty.noMatch : source.note;
  return { kind, title, options, ...(message ? { message } : {}) };
}

/**
 * The sections of the "@" picker for a query. `atStart` is true when the "@" is the first word
 * of the message. Then the picker also offers the "@docs" search.
 */
export function mentionSections(
  query: string,
  atStart: boolean,
  sources: MentionSourceSet,
): MentionSection[] {
  const limit = query ? 8 : 5;
  const small = 5;
  const sections: MentionSection[] = [];
  if (atStart && 'docs'.startsWith(query.toLowerCase()))
    sections.push({
      kind: 'search',
      title: 'Search',
      options: [
        {
          key: 'search:docs',
          kind: 'search',
          label: '@docs',
          detail: 'Search project docs',
          insert: '@docs',
        },
      ],
    });
  sections.push(
    section(
      'file',
      'Files',
      sources.files,
      query,
      limit,
      (path) => fileScore(query, path),
      (path) => {
        const at = path.lastIndexOf('/');
        return {
          id: path,
          label: path.slice(at + 1),
          ...(at > 0 ? { detail: path.slice(0, at) } : {}),
        };
      },
      { none: 'No files in this folder', noMatch: 'No files match' },
    ),
    section(
      'doc',
      'Docs',
      sources.docs,
      query,
      small,
      (doc) => fuzzyScore(query, doc.title),
      (doc) => ({ id: doc.id, label: doc.title || 'Untitled' }),
      { none: 'No docs in this project', noMatch: 'No docs match' },
    ),
    section(
      'task',
      'Tasks',
      sources.tasks.status === 'ready'
        ? { ...sources.tasks, items: sources.tasks.items.filter((item) => !item.archived) }
        : sources.tasks,
      query,
      small,
      (task) => fuzzyScore(query, `${task.number ? '#' + task.number + ' ' : ''}${task.title}`),
      (task) => ({
        id: task.id,
        label: `${task.number ? '#' + task.number + ' ' : ''}${task.title || 'Untitled'}`,
        ...(task.status ? { detail: task.status } : {}),
      }),
      { none: 'No tasks on the board', noMatch: 'No tasks match' },
    ),
    section(
      'memory',
      'Memory',
      sources.memory,
      query,
      small,
      (entry) => fuzzyScore(query, `${entry.topic} ${entry.content.slice(0, 200)}`),
      (entry) => ({
        id: entry.id,
        label: entry.topic || entry.content.slice(0, 60),
        detail: entry.content.replace(/\s+/g, ' ').slice(0, 80),
      }),
      { none: 'No memory entries yet', noMatch: 'No memory entries match' },
    ),
    section(
      'chat',
      'Chats',
      { status: 'ready', items: sources.chats },
      query,
      small,
      (chat) => fuzzyScore(query, chat.title),
      (chat) => ({
        id: chatMentionId(chat.agent, chat.id),
        label: chat.title || 'Untitled chat',
        detail: agentLabel(chat.agent),
      }),
      { none: 'No other chats in this project', noMatch: 'No chats match' },
    ),
  );
  return sections;
}

/** The options of all sections in order, for the arrow keys. */
export function flatOptions(sections: MentionSection[]) {
  return sections.flatMap((item) => item.options);
}
