import { useState, type ComponentProps } from 'react';
import type { Project, ProjectGroup, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';
import { SessionBrowser } from './session-browser';
import { trackerConnection } from '../domain/tracker';

type BrowserProps = ComponentProps<typeof SessionBrowser>;

/**
 * The Chats tab of a project: every chat in its code folders, with its status. The filter row
 * starts with the search, then the view, the agent, the code folder and the task. The project
 * header above has the one "New chat" button.
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
  return (
    <section className="page project-chats" aria-label="Project chats">
      <SessionBrowser
        {...browser}
        storageKey={`project-chats:${group.id}`}
        sessions={own}
        query={query}
        onQueryChange={setQuery}
        filterBy="folder"
        hasBoard={() => !!trackerConnection(group)}
        placeOf={(session) => ({
          project: group.name,
          folder: sessionRepo(session, repos)?.name,
        })}
      />
    </section>
  );
}
