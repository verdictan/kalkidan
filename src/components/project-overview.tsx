import { CreateProject } from './create-project';
import { useEffect, useState } from 'react';
import { ChevronDown, Folder, Loader2, Plus } from 'lucide-react';
import { agentCatalog } from '../config/agents';
import { onChatPreferencesChange, readEnterToSend } from '../lib/chat-preferences';
import { strongestStatus } from '../domain/identity';
import type { WorkspaceIdentity } from '../hooks/use-workspace-identity';
import { Button } from './ui/button';
import { IdentityMark } from './ui/identity-mark';
import { PageHeader } from './ui/page-header';
import { StatusGlyph } from './ui/status-glyph';
import type { API, Agent, ProjectGroup, Project, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';
import { fullTime } from '../lib/relative-time';
import { projectAge } from '../lib/project-age';
import { folderName, showFolderImportResult, useFolderImport } from './repository-import';
import { showToast } from './ui/toast';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { Composer, NewChatAccessPill, composerChipClass } from './composer';
import { AgentPicker } from './model-chip';
import { FoundFolderChips } from './found-folders';
import { requestNewChat, usePreferredAgent } from './new-chat-button';
import {
  activityKey,
  activityLabels,
  itemStatusOf,
  useActivityState,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';

/** A chat that waits for the user, or a run that finished and is not seen yet. */
export interface NeedsYouItem {
  session: Session;
  repo: Project;
  /** "Waiting for your approval", "Waiting for your answer" or "Finished". */
  reason: string;
  state?: SessionActivityState;
  at?: string;
}

/**
 * The chats that wait for the user: approvals and questions first, then finished runs that
 * the user did not open yet. `repos` limits the list to some code folders.
 */
export function useNeedsYou(sessions: Session[], repos: Project[]): NeedsYouItem[] {
  const { activity, finished } = useActivityState();
  const find = (agent: string, id: string) =>
    sessions.find((s) => s.agent === agent && s.id === id);
  const items: NeedsYouItem[] = [];
  for (const item of activity) {
    if (!waitsForUser(item.state)) continue;
    const session = find(item.agent, item.id);
    const repo = session && sessionRepo(session, repos);
    if (session && repo)
      items.push({ session, repo, reason: activityLabels[item.state], state: item.state });
  }
  for (const item of finished) {
    if (items.some((entry) => entry.session.agent === item.agent && entry.session.id === item.id))
      continue;
    const session = find(item.agent, item.id);
    const repo = session && sessionRepo(session, repos);
    if (session && repo) items.push({ session, repo, reason: 'Finished', at: item.at });
  }
  return items;
}

/**
 * The first window when there is no project yet: one composer. "Choose a folder" picks the
 * code; Send makes a project from the folder and starts the chat with the message.
 */
function StartComposer({ api, onRefresh }: { api: API; onRefresh: () => Promise<void> }) {
  const folderImport = useFolderImport(api, 'start');
  const [folder, setFolder] = useState<{ root: string; paths: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const preferred = usePreferredAgent();
  const [agent, setAgent] = useState<Agent>(preferred);
  useEffect(() => setAgent(preferred), [preferred]);
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  useEffect(() => onChatPreferencesChange(() => setEnterToSend(readEnterToSend())), []);
  async function chooseFolder() {
    if (!folderImport.supported) {
      showToast('Open the desktop app to choose a folder.');
      return null;
    }
    const result = await folderImport.choose('Choose a code folder', 'Choose');
    if (result) setFolder(result);
    return result;
  }
  async function start() {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const chosen = folder || (await chooseFolder());
    if (!chosen) return;
    setBusy(true);
    try {
      const name = folderName(chosen.root);
      const id = await api.createGroup(name, '', undefined, 'github', undefined, undefined, [
        ...chosen.paths,
      ]);
      await onRefresh();
      const snapshot = await api.snapshot();
      const group = snapshot.groups?.find((g) => g.id === id);
      showFolderImportResult(name, group?.repoIds.length ?? 0);
      if (!group?.repoIds.length) return;
      requestNewChat({ groupId: group.id, repoId: group.repoIds[0], agent, prompt, send: true });
      setText('');
    } catch (error) {
      showToast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="start-composer">
      <img
        className="start-composer-mark"
        src="./brand/kalkidan-mark.svg"
        alt=""
        aria-hidden="true"
        width="32"
        height="32"
      />
      <h1 className="start-composer-title">What are we working on?</h1>
      <Composer
        label="New chat"
        inputLabel="Message for a new chat"
        placeholder="Describe a change…"
        sendLabel="Start the chat"
        value={text}
        onValueChange={setText}
        onSend={() => void start()}
        canSend={!!text.trim() && !busy}
        enterToSend={enterToSend}
        controls={
          <>
            <Button
              variant="chip"
              className={composerChipClass}
              disabled={busy}
              onClick={() => void chooseFolder()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Folder aria-hidden="true" />}
              <span className="truncate">
                {folder ? folderName(folder.root) : 'Choose a folder'}
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
            <NewChatAccessPill />
            <AgentPicker
              api={api}
              agent={agent}
              allComputers={!folder}
              onAgentChange={(value) => {
                const next = agentCatalog.find((item) => item.id === value)?.id;
                if (next) setAgent(next);
              }}
            />
          </>
        }
      />
      <FoundFolderChips
        api={api}
        chosen={folder?.root}
        disabled={busy}
        onChoose={(path) =>
          void folderImport.scanFolder(path).then((result) => result && setFolder(result))
        }
      />
    </div>
  );
}

/**
 * The Projects page: the root of the tree. One row for each project with its mark, its repos,
 * the strongest status of its chats and the time of its last chat. Without a project, the page
 * is the first composer.
 */
export function ProjectOverview({
  api,
  groups,
  repos,
  sessions,
  identity,
  onSelect,
  onOpenWindow,
  onRefresh,
}: {
  api: API;
  groups: ProjectGroup[];
  repos: Project[];
  sessions: Session[];
  identity: WorkspaceIdentity;
  onSelect: (group: ProjectGroup) => void;
  onOpenWindow?: (group: ProjectGroup) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { activity } = useActivityState();
  const live = (session: Session) =>
    activity.find((item) => item.agent === session.agent && item.id === session.id)?.state;
  if (!groups.length)
    return (
      <section className="page start-page" aria-label="New chat">
        <StartComposer api={api} onRefresh={onRefresh} />
      </section>
    );
  const recent = sessions
    .filter((s) => !s.organization?.archived && !s.id.startsWith('draft-'))
    .map((session) => ({ session, repo: sessionRepo(session, repos) }))
    .filter((item): item is { session: Session; repo: Project } => !!item.repo)
    .sort((a, b) => (b.session.updatedAt || '').localeCompare(a.session.updatedAt || ''));
  const statusWords: Record<string, string> = {
    'needs-you': 'Needs you',
    working: 'Working',
    failed: 'Failed',
  };
  return (
    <div className="project-frame projects-page" data-page="projects">
      {/* SP-C2: a top-level page has an empty title bar with no line. The title row names it. */}
      <PageHeader className="projects-page-bar" />
      {/* SP-C2: the title row of the page, with the brown New project button at the right. */}
      <div className="page-head" data-title-row="">
        <div className="page-head-row">
          <h1 className="page-head-title page-title">Projects</h1>
          <span className="app-header-spacer" />
          <Button className="has-[>svg]:px-3" onClick={() => setOpen(true)}>
            <Plus />
            New project
          </Button>
        </div>
      </div>
      <div className="project-frame-body">
        <section className="page" aria-label="Projects">
          {/* SP-C2: a table with Name, Activity and Updated. Each row opens its project. */}
          <div className="projects-table">
            <div className="projects-table-head" aria-hidden="true">
              <span>Name</span>
              <span>Activity</span>
              <span>Updated</span>
            </div>
            <ul className="projects-table-rows" aria-label="Projects">
              {groups.map((group) => {
                const members = repos.filter((repo) => group.repoIds.includes(repo.id));
                const chats = recent.filter(({ repo }) => group.repoIds.includes(repo.id));
                const status = strongestStatus(
                  chats.map(({ session }) => itemStatusOf(live(session))),
                );
                const last = chats[0]?.session.updatedAt;
                const count = members.length ? plural(members.length, 'repo') : 'No repos yet';
                const word = status ? statusWords[status] : undefined;
                const activityText = word ? `${word} · ${count}` : count;
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      className="projects-table-row"
                      aria-label={`${group.name}, ${activityText}`}
                      onClick={() => onSelect(group)}
                      onDoubleClick={onOpenWindow ? () => onOpenWindow(group) : undefined}
                    >
                      <span className="projects-table-name">
                        <IdentityMark kind="project" color={identity.project(group)} />
                        <span className="truncate">{group.name}</span>
                      </span>
                      <span className="projects-table-activity">
                        {status && status !== 'idle' && <StatusGlyph status={status} />}
                        <span className="truncate">{activityText}</span>
                      </span>
                      <span className="projects-table-updated">
                        {last && (
                          <time dateTime={last} title={fullTime(last)}>
                            {projectAge(last)}
                          </time>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
      <CreateProject
        api={api}
        open={open}
        onOpenChange={setOpen}
        onCreated={async (group) => {
          await onRefresh();
          onSelect(group);
        }}
      />
    </div>
  );
}
/** The key of a chat for the "Needs you" lists. */
export const needsYouKey = (item: NeedsYouItem) => activityKey(item.session.agent, item.session.id);
