import { useState } from 'react';
import Markdown from 'react-markdown';
import { Brain, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import type { API, ProjectGroup } from '../types';
import { useProjectResource } from '../hooks/use-project-resource';

export function ProjectMemoryPanel({ api, group }: { api: API; group: ProjectGroup }) {
  const { state, refresh } = useProjectResource(api, group, 'memory', () =>
    api.memoryList(group.id),
  );
  const memory = state.value;
  const error = state.error || '';
  const [selected, setSelected] = useState('');
  const page = memory?.pages.find((item) => item.name === selected) || memory?.pages[0];
  return (
    <section className="project-memory" aria-label="Project memory">
      <header className="flex items-start justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Brain size={20} />
            {group.name} memory
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reusable knowledge saved by your agents. Read only.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh memory"
          disabled={state.status === 'loading' || state.status === 'refreshing'}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
        </Button>
      </header>
      {memory?.extraction && (
        <p className="py-3 text-sm text-muted-foreground" role="status">
          Memory extraction: {memory.extraction.status}
          {memory.extraction.saved !== undefined
            ? ` · ${memory.extraction.saved} sourced entries`
            : ''}
          .{memory.extraction.error && ' ' + memory.extraction.error}
        </p>
      )}
      {error && (
        <p role="alert" className="py-4 text-destructive">
          {error}
        </p>
      )}
      {!memory && !error && (
        <p role="status" className="py-8 text-muted-foreground">
          Loading memory…
        </p>
      )}
      {memory && !memory.pages.length && (
        <div className="py-16 text-center">
          <Brain size={32} className="mx-auto mb-4 text-muted-foreground" />
          <h2>No project memory yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            As agents work, they can save verified decisions, conventions, and recurring fixes here
            for future tasks.
          </p>
        </div>
      )}
      {page && (
        <div className="memory-layout">
          <nav aria-label="Memory topics" className="space-y-1">
            {memory?.pages.map((item) => (
              <Button
                key={item.name}
                variant={item.name === page.name ? 'secondary' : 'ghost'}
                className="w-full justify-start overflow-hidden"
                aria-current={item.name === page.name ? 'page' : undefined}
                onClick={() => setSelected(item.name)}
              >
                <span className="truncate">
                  {item.topic || item.name.replace(/\.md$/, '').replace(/[-_]/g, ' ')}
                </span>
              </Button>
            ))}
          </nav>
          <article className="min-w-0 break-words">
            <h2 className="text-lg font-semibold">{page.topic || page.name}</h2>
            <p className="mb-6 mt-1 text-xs text-muted-foreground">
              Updated {new Date(page.updatedAt).toLocaleString()}
            </p>
            <div className="memory-markdown">
              <Markdown skipHtml>{page.content}</Markdown>
            </div>
            {page.truncated && (
              <p className="mt-4 text-sm text-muted-foreground">Preview limited to 64 KB.</p>
            )}
          </article>
        </div>
      )}
      {memory?.limited && (
        <p className="py-4 text-sm text-muted-foreground">
          Some files are omitted from this preview. The files remain in the project memory folder.
        </p>
      )}
    </section>
  );
}
