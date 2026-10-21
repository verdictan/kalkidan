import { useRef, type KeyboardEvent } from 'react';
import type { ProjectPage } from '../domain/workspace-route';

/** The pages of a project, in the order of the tab bar. */
export const projectTabs: { page: ProjectPage; label: string }[] = [
  { page: 'board', label: 'Overview' },
  { page: 'tasks', label: 'Tasks' },
  { page: 'chats', label: 'Chats' },
  { page: 'docs', label: 'Docs' },
  { page: 'memory', label: 'Memory' },
  { page: 'insights', label: 'Insights' },
];

/** Opens a page of a project. The shell listens for this event and changes the route. */
export function openProjectPage(
  groupId: string,
  page: ProjectPage,
  extra?: { docId?: string; topic?: string },
) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', { detail: { groupId, page, ...extra } }),
  );
}

/**
 * One tab bar for the pages of a project: Overview, Tasks, Chats, Docs, Memory and Insights.
 * Each tab is a link to a page, so the bar is a navigation landmark. The current page has
 * aria-current. The arrow keys, Home and End move the focus between the tabs.
 */
export function ProjectTabs({
  groupId,
  page,
  onSelect,
  className,
}: {
  groupId: string;
  /** The page that shows now. */
  page: ProjectPage;
  /** Called before the event goes to the shell, so a page can switch at once. */
  onSelect?: (page: ProjectPage) => void;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(list.current?.querySelectorAll('button') || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
  }
  return (
    <nav
      aria-label="Project page"
      className={className ? `project-tabs ${className}` : 'project-tabs'}
    >
      <div ref={list} className="project-tabs-list" onKeyDown={move}>
        {projectTabs.map((tab) => {
          const current = tab.page === page;
          return (
            <button
              key={tab.page}
              type="button"
              className="project-tab"
              aria-current={current ? 'page' : undefined}
              // One tab stop: the current tab. The arrow keys reach the others.
              tabIndex={current ? 0 : -1}
              onClick={() => {
                if (current) return;
                onSelect?.(tab.page);
                openProjectPage(groupId, tab.page);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
