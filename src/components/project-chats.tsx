import { useState, type ComponentProps } from 'react';
import type { Project, ProjectGroup, Session } from '../types';
import { projectSessions, sessionRepo } from '../lib/session-repository';
import { plural } from '../lib/platform';
import { ProjectHeaderActions, ProjectHeaderMeta } from './project-header';
import { SessionBrowser } from './session-browser';
import { SearchInput } from './ui/search-input';

type BrowserProps = ComponentProps<typeof SessionBrowser>;

/**
 * The Chats tab of a project: every chat in its code folders, with its status, and filters for
 * the view, the agent, the code folder and the task. The count is the same as in the sidebar,
 * All chats and the overview.
 */
export function ProjectChats({
  group,
  repos,
  sessions,
  ...browser
}: {
  group: ProjectGroup;
  /** All code folders. The tab uses the code folders of this project. */
  repos: Project[];
  sessions: Session[];
} & Pick<
  BrowserProps,
  | 'api'
  | 'onChanged'
  | 'activity'
  | 'busy'
  | 'taskOf'
  | 'onOpenTask'
  | 'onResume'
  | 'onUpdate'
  | 'onSessionCommand'
>) {
  const [query, setQuery] = useState('');
  const own = sessions.filter((session) =>
    group.repoIds.includes(sessionRepo(session, repos)?.id || ''),
  );
  const count = projectSessions(sessions, group, repos).length;
  return (
    <section className="page project-chats" aria-label="Project chats">
      <ProjectHeaderMeta>
        <span className="tracker-subtitle-count">· {plural(count, 'chat')}</span>
      </ProjectHeaderMeta>
      <ProjectHeaderActions>
        <SearchInput
          size="sm"
          className="repository-session-filter"
          aria-label="Filter chats"
          placeholder="Filter chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </ProjectHeaderActions>
      <SessionBrowser
        {...browser}
        storageKey={`project-chats:${group.id}`}
        sessions={own}
        query={query}
        filterBy="folder"
        placeOf={(session) => ({
          project: group.name,
          folder: sessionRepo(session, repos)?.name,
        })}
      />
    </section>
  );
}
