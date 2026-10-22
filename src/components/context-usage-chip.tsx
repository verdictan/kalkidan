import { useEffect, useState } from 'react';
import { BookOpen, FileText, Lightbulb } from 'lucide-react';
import type { API } from '../types';
import type { ContextUsage } from '../domain/memory';
import { plural } from '../lib/platform';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * Calls `read` now, when the window gets focus, and when the memory or docs of the project
 * change.
 */
function useProjectReload(api: API, groupId: string, read: () => void) {
  useEffect(() => {
    read();
    const unsubscribe = api.onProjectResourceChange?.((event) => {
      if (event.groupId === groupId) read();
    });
    window.addEventListener('focus', read);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, groupId]);
}

/** How many chats read each memory fact and each doc page of a project. */
export function useReadCounts(api: API, groupId: string) {
  const [counts, setCounts] = useState<{
    memory: Record<string, number>;
    docs: Record<string, number>;
  }>();
  useProjectReload(api, groupId, () => {
    if (typeof api.readCounts !== 'function') return;
    void api
      .readCounts(groupId)
      .then(setCounts)
      .catch(() => setCounts(undefined));
  });
  return counts;
}

/** "Context: 3 facts · 1 page", or an empty text when the agent read nothing. */
export function contextUsageLabel(usage: ContextUsage | undefined) {
  if (!usage) return '';
  const parts = [
    usage.memory.length ? plural(usage.memory.length, 'fact') : '',
    usage.docs.length ? plural(usage.docs.length, 'page') : '',
  ].filter(Boolean);
  return parts.length ? `Context: ${parts.join(' · ')}` : '';
}

const openKnowledge = (detail: Record<string, string>) =>
  window.dispatchEvent(new CustomEvent('kalkidan-open-project-page', { detail }));

/**
 * The facts and pages that the agent read in one chat. It shows under the last answer, with
 * its text on the edge of the message column. A click lists them; an item opens it in the
 * Knowledge tab. Nothing shows when the agent read nothing.
 */
export function ContextUsageChip({
  api,
  groupId,
  agent,
  sessionId,
}: {
  api: API;
  groupId: string;
  agent: string;
  /** The provider session ID of the chat. */
  sessionId: string;
}) {
  const [usage, setUsage] = useState<ContextUsage>();
  useEffect(() => setUsage(undefined), [groupId, agent, sessionId]);
  useProjectReload(api, `${groupId}`, () => {
    if (typeof api.contextUsage !== 'function' || !sessionId) return;
    void api
      .contextUsage(groupId, agent, sessionId)
      .then(setUsage)
      .catch(() => setUsage(undefined));
  });
  const label = contextUsageLabel(usage);
  if (!usage || !label) return null;
  return (
    <div className="context-usage">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="chip" aria-label={`${label}. Show what the agent read`}>
            <BookOpen aria-hidden="true" />
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width="wide">
          {usage.memory.length > 0 && <DropdownMenuLabel>Facts</DropdownMenuLabel>}
          {usage.memory.map((fact) => (
            <DropdownMenuItem
              key={fact.id}
              onSelect={() =>
                openKnowledge({
                  groupId,
                  page: 'knowledge',
                  section: 'memory',
                  topic: fact.topic,
                  factId: fact.id,
                })
              }
            >
              <Lightbulb aria-hidden="true" />
              {fact.title || fact.topic}
            </DropdownMenuItem>
          ))}
          {usage.docs.length > 0 && <DropdownMenuLabel>Pages</DropdownMenuLabel>}
          {usage.docs.map((doc) => (
            <DropdownMenuItem
              key={doc.docId + (doc.heading || '')}
              onSelect={() =>
                openKnowledge({
                  groupId,
                  page: 'knowledge',
                  section: 'pages',
                  docId: doc.docId,
                  ...(doc.heading ? { heading: doc.heading } : {}),
                })
              }
            >
              <FileText aria-hidden="true" />
              {doc.title || 'Untitled'}
              {doc.heading ? ` › ${doc.heading}` : ''}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
