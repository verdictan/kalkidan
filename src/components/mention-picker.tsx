import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  Brain,
  FileCode,
  FileText,
  ListTodo,
  MessagesSquare,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { trackerConnection } from '../domain/tracker';
import type { MemoryEntry } from '../domain/memory';
import { mentionSegments, type MentionKind } from '../domain/mentions';
import { trackerClient } from '../lib/tracker-client';
import { errorMessage } from '../lib/errors';
import { caretCoordinates } from '../lib/caret';
import type {
  MentionSection,
  MentionSource,
  MentionSourceSet,
  MentionChat,
} from '../lib/mention-sections';
import type { API, ProjectGroup, TrackerItem } from '../types';

export const mentionIcons: Record<MentionKind | 'search', LucideIcon> = {
  search: Search,
  file: FileCode,
  doc: FileText,
  task: ListTodo,
  memory: Brain,
  chat: MessagesSquare,
};

// The picker reads the sources again when it opens after this time.
const freshFor = 30000;

/**
 * Reads the files, docs, tasks and memory of the project when the "@" picker opens. Each source
 * loads alone, so a slow or failed source does not stop the others.
 */
export function useMentionSources({
  api,
  projectGroup,
  cwd,
  hostId,
  chats,
  enabled,
}: {
  api: API;
  projectGroup?: ProjectGroup;
  cwd: string;
  hostId?: string;
  chats: MentionChat[];
  enabled: boolean;
}): MentionSourceSet {
  const loading = { status: 'loading' } as const;
  const [files, setFiles] = useState<MentionSource<string>>(loading);
  const [docs, setDocs] = useState<MentionSource<{ id: string; title: string }>>(loading);
  const [tasks, setTasks] = useState<MentionSource<TrackerItem>>(loading);
  const [memory, setMemory] = useState<MentionSource<MemoryEntry>>(loading);
  const loadedAt = useRef(0);
  const generation = useRef({ key: '', value: 0 });
  const groupId = projectGroup?.id;
  const connection = trackerConnection(projectGroup);
  const key = [groupId, cwd, hostId, connection?.project.id].join('\n');
  useEffect(() => {
    // A new project or folder reads all sources again. Late results of the old one are dropped.
    if (generation.current.key !== key) {
      generation.current = { key, value: generation.current.value + 1 };
      loadedAt.current = 0;
      if (generation.current.value > 1)
        for (const set of [setFiles, setDocs, setTasks, setMemory]) set({ status: 'loading' });
    }
    if (!enabled || !groupId || Date.now() - loadedAt.current < freshFor) return;
    loadedAt.current = Date.now();
    const mine = generation.current.value;
    const current = () => generation.current.value === mine;
    const read = <T,>(
      set: (state: MentionSource<T>) => void,
      load: () => Promise<{ items: T[]; note?: string }>,
    ) => {
      load()
        .then((result) => current() && set({ status: 'ready', ...result }))
        .catch((error) => {
          if (!current()) return;
          loadedAt.current = 0;
          set({ status: 'error', message: errorMessage(error) });
        });
    };
    read(setFiles, async () => {
      if (typeof api.mentionFiles !== 'function')
        throw new Error('File mentions need the desktop app.');
      const list = await api.mentionFiles(cwd, hostId);
      return {
        items: list.files,
        ...(list.truncated
          ? { note: `Showing the first ${list.files.length.toLocaleString()} files` }
          : {}),
      };
    });
    read(setDocs, async () => ({ items: await api.docsMetadata(groupId) }));
    read(setMemory, async () => ({ items: await api.memoryEntries(groupId) }));
    if (!connection) setTasks({ status: 'none', message: 'Connect a board to mention tasks' });
    else
      read(setTasks, async () => ({
        items: (await trackerClient(api, connection.provider).board(groupId)).items,
      }));
  }, [enabled, key]);
  return { files, docs, tasks, memory, chats };
}

/** The "@" picker. It opens above the caret, in the composer. */
export function MentionPicker({
  id,
  sections,
  active,
  anchor,
  index,
  onPick,
  onHover,
}: {
  id: string;
  sections: MentionSection[];
  active: number;
  /** The composer textarea. */
  anchor: RefObject<HTMLTextAreaElement | null>;
  /** The position of the "@" in the text. */
  index: number;
  onPick: (option: MentionSection['options'][number]) => void;
  onHover: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const textarea = anchor.current;
    const parent = list.current?.offsetParent;
    if (!textarea || !parent) return;
    const caret = caretCoordinates(textarea, index);
    const box = parent.getBoundingClientRect();
    const field = textarea.getBoundingClientRect();
    const width = list.current!.offsetWidth;
    const left = Math.max(0, Math.min(field.left - box.left + caret.left, box.width - width));
    const bottom = box.bottom - (field.top + caret.top) + 4;
    setPosition((previous) =>
      previous?.left === left && previous.bottom === bottom ? previous : { left, bottom },
    );
  }, [index, anchor.current?.value]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${active}`)}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  let count = 0;
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="Mentions"
      className="mention-picker"
      style={position ? { left: position.left, bottom: position.bottom } : { visibility: 'hidden' }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {sections.map((section) => {
        const Icon = mentionIcons[section.kind];
        return (
          <div
            key={section.kind}
            role="group"
            aria-labelledby={`${id}-${section.kind}`}
            className="mention-picker-section"
          >
            <div id={`${id}-${section.kind}`} className="mention-picker-heading">
              {section.title}
            </div>
            {section.options.map((option) => {
              const position = count++;
              return (
                <div
                  key={option.key}
                  id={`${id}-${position}`}
                  role="option"
                  aria-selected={position === active}
                  className="mention-picker-option"
                  onMouseMove={() => position !== active && onHover(position)}
                  onClick={() => onPick(option)}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{option.label}</span>
                  {option.detail && (
                    <span className="mention-picker-detail truncate">{option.detail}</span>
                  )}
                </div>
              );
            })}
            {section.message && (
              <div className="menu-empty" role="presentation">
                {section.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A small chip for a mention, on a sent message or in the composer. */
export function MentionChip({
  kind,
  label,
  children,
}: {
  kind: MentionKind;
  label: string;
  children?: React.ReactNode;
}) {
  const Icon = mentionIcons[kind];
  return (
    <span className="mention-chip" data-kind={kind} title={label}>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {children}
    </span>
  );
}

/**
 * The text of a user message for Markdown. Each mention becomes a link with the
 * "kalkidan-mention:" scheme, and the Markdown link renderer shows it as a chip.
 */
export function mentionMarkdown(text: string) {
  return mentionSegments(text)
    .map((part) =>
      typeof part === 'string'
        ? part
        : `[${part.label.replace(/[\\`*_<>]/g, '\\$&')}](kalkidan-mention:${part.kind})`,
    )
    .join('');
}
