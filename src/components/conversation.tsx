import { interfaceConfig } from '../config/interface';
import { trackerConnection } from '../domain/tracker';
import { keychainWaitingMessage, managedOnlyNotice } from '../domain/verdictan';
import { trackerClient } from '../lib/tracker-client';
import {
  ConversationTools,
  noChangesToCommit,
  type ConversationContext,
  type ToolKind,
  type ToolRequest,
} from './conversation-tools';
import { PolicyResultCard } from './policy-result';
import { addPolicyRecords, chatPolicyLimit, type PolicyRecord } from '../domain/policy-result';
import { AgentActivity, RunRequests, runLineCounts } from './agent-activity';
import { useContextUsage } from './context-usage-chip';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import { changeTaskStatus } from '../lib/task-status';
import { agentCatalog, agentLabel } from '../config/agents';
import { ConfirmDialog } from './confirm-dialog';
import { CommitDialog, reportChatMenuState } from './session-menu';
import { ModelChip, useModelChoice } from './model-chip';
import { chosenModel } from '../domain/model-choice';
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  AtSign,
  FileDiff,
  FileText,
  ListTodo,
  LoaderCircle,
  Lock,
  LogIn,
  Paperclip,
  Search,
  Square,
  X,
} from 'lucide-react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, AlertDescription } from './ui/alert';
import { ReadOnlyConversation, useConversationOwnership } from './conversation-ownership';
import { isReadOnly } from '../domain/conversation-ownership';
import { showToast } from './ui/toast';
import { errorMessage } from '../lib/errors';
import { agentErrorMessage, managedLaunchError, type AgentError } from '../lib/agent-errors';
import { takePendingDraft } from '../lib/pending-draft';
import { composerAfterSubmit, contextsAfterSubmit } from '../lib/composer-draft';
import {
  hasBranchWork,
  moveTaskToReview,
  pullRequestActionLabel,
  pullRequestLabel as pullRequestLabelText,
  type SessionPullRequest,
} from '../lib/pull-request';
import type { ProjectDocMetadata } from '../domain/docs';
import type { DocPassage } from '../domain/docs';
import {
  AgentErrorActions,
  AgentErrorNote,
  SaveToDocsDialog,
  SendFailure,
  TaskLinkDialog,
  dispatchApp,
  forkChat,
  openExternal,
  openTask,
  startSignIn,
  takeQueuedSessionCommand,
} from './chat-links';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { DocPagePicker } from './doc-page-picker';
import { MentionChip, MentionPicker, mentionMarkdown, useMentionSources } from './mention-picker';
import { flatOptions, mentionSections, type MentionChat } from '../lib/mention-sections';
import {
  activeMention,
  insertMention,
  mentionPlainText,
  parseMentions,
  removeMention,
  removeMentionBefore,
} from '../domain/mentions';
import { pathBasename, plural, shortcutLabel } from '../lib/platform';
import { onChatPreferencesChange, readEnterToSend } from '../lib/chat-preferences';
import {
  AccessPill,
  Composer,
  ComposerAddMenu,
  FolderPill,
  composerPlaceholderFor,
  defaultAccess,
  isOwnBranchCopy,
  readAccess,
  saveAccess,
  takeNextChatModel,
  type ChatAccess,
} from './composer';
import { Tag } from './ui/tag';
import type { WorkingStatus } from '../api/contracts';
import { markDraftOutcome, type SessionActivityState } from './activity-dot';
import { chatOutcomeOf } from '../domain/chat-outcome';
import { Button } from './ui/button';
import type {
  API,
  ChatMessage,
  ChatRun,
  Session,
  ModelOption,
  ProjectGroup,
  TrackerItem,
} from '../types';

/** Unsent text and attachments. They stay when the session view is unmounted. */
export type ConversationDraft = { prompt: string; contexts: ConversationContext[] };

const sendShortcut = shortcutLabel(['mod'], 'Enter');
// The "+" menu offers this many doc pages. "All pages…" opens the page picker.
const recentPageLimit = 6;

// The words that agents use when a read-only run cannot change a file: Codex reports the
// read-only sandbox, Claude Code reports plan mode or a permission denial.
const writeRefusal =
  /read[- ]only (sandbox|mode|file ?system)|plan mode|permission to (use )?(write|edit)|denied by the agent permission policy|haven(?:'|’)t granted|not (allowed|permitted) to (write|edit|modify|change)|(cannot|can(?:'|’)t|unable to) (write|edit|modify|change|create) (files|the file|this file)|EROFS|EACCES|operation not permitted/i;
/** True when a run tried to change files but its read-only permission stopped it. */
function refusedWrite(run: ChatRun) {
  if (run.error && writeRefusal.test(run.error)) return true;
  if (
    run.tools?.some(
      (tool) =>
        ['declined', 'failed'].includes(tool.status) &&
        writeRefusal.test(`${tool.title}\n${tool.detail || ''}`),
    )
  )
    return true;
  return run.messages.some((message) => message.role !== 'user' && writeRefusal.test(message.text));
}

/** The blocked launch of a chat run, with its safe code and found version. */
function launchFailure(run: ChatRun) {
  return {
    message: run.error || '',
    step: run.managedSetup,
    code: run.managedCode,
    version: run.agentVersion,
    path: run.agentPath,
  };
}

/** A message that did not reach the agent. Its error shows under the message. */
interface SendFailureState {
  messageId: string;
  text: string;
  prompt: string;
  error: AgentError;
}

/** The "@docs" search text of a message, or an empty string. The desktop app uses the same rule. */
function docsQuery(text: string) {
  return /^\s*@docs(?:\s+|$)/i.test(text) ? text.replace(/^\s*@docs(?:\s+|$)/i, '').trim() : '';
}

/** The chat as Markdown for a doc page. */
function chatMarkdown(title: string, agentName: string, messages: ChatMessage[]) {
  return [
    `# ${title}`,
    ...messages.map(
      (message) => `## ${message.role === 'user' ? 'You' : agentName}\n\n${message.text.trim()}`,
    ),
  ].join('\n\n');
}

/** Only web and mail links open outside Kalkidan. Other links show as text. */
function safeLink(href: string | undefined) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the mention links of user messages. Other links use the default rules. */
function mentionUrl(url: string) {
  return /^kalkidan-mention:(file|doc|task|memory|chat)$/.test(url)
    ? url
    : defaultUrlTransform(url);
}

/** The items that a sent message mentions, as small chips under the message. */
function SentMentions({ text }: { text: string }) {
  const mentions = parseMentions(text);
  if (!mentions.length) return null;
  return (
    <div className="chat-mentions" role="list" aria-label="Mentioned items">
      {mentions.map((mention) => (
        <span role="listitem" key={mention.kind + ':' + mention.id}>
          <MentionChip kind={mention.kind} label={mention.label} />
        </span>
      ))}
    </div>
  );
}

export function Conversation({
  api,
  session,
  projectGroup,
  repositoryId,
  titlebarVisible = true,
  open,
  draft,
  onDraftChange,
  onComplete,
  onActivityChange,
  onSessionCreated,
  onTitleChange,
  onAgentChange,
  onStartNew,
  hostName,
  mentionChats = [],
  folders = [],
}: {
  api: API;
  /** The code folders of the project. The folder pill of a new chat lists them. */
  folders?: { id: string; name: string }[];
  /** The other chats of the project, for "@" mentions. */
  mentionChats?: MentionChat[];
  /** The name of the SSH host of the session. Refusal messages name it. */
  hostName?: string;
  titlebarVisible?: boolean;
  projectGroup?: ProjectGroup;
  /** The repository entry of the session checkout. */
  repositoryId?: string;
  draft?: ConversationDraft;
  onDraftChange?: (draft: ConversationDraft | null) => void;
  session: Session;
  open: boolean;
  onComplete: () => void;
  onActivityChange: (activity: SessionActivityState | null) => void;
  onSessionCreated?: (id: string, title: string) => void;
  /** Gives the chat a title from its first message when the first send fails. */
  onTitleChange?: (title: string) => void;
  /** Changes the agent of a new chat before its first message. It keeps the linked task. */
  onAgentChange?: (agent: string, taskId?: string) => void;
  /** Opens a new, empty chat under the active account, in the same code folder. */
  onStartNew?: () => void;
}) {
  // The computer where the agent runs, for refusal messages.
  const computer = session.hostId ? hostName || 'the SSH host' : 'this computer';
  // A chat of another account or organization is read-only. Its context and usage stay there.
  const ownership = useConversationOwnership(api, session, open);
  const readOnly = isReadOnly(ownership);
  const [toolOpen, setToolOpen] = useState<ToolKind | null>(null);
  const [toolRequest, setToolRequest] = useState<ToolRequest | null>(null);
  const showTool = (kind: ToolRequest['kind'], toggle = false) =>
    setToolRequest((previous) => ({ kind, n: (previous?.n || 0) + 1, toggle }));
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [recentPages, setRecentPages] = useState<ProjectDocMetadata[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState<WorkingStatus | null>(null);
  const [runsFinished, setRunsFinished] = useState(0);
  const [editsRefused, setEditsRefused] = useState(false);
  const runEdits = useRef(false);
  const permissionTouched = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Settings › General: Enter sends, or ⌘Enter (Ctrl+Enter) sends and Enter adds a line.
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  useEffect(() => onChatPreferencesChange(() => setEnterToSend(readEnterToSend())), []);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<TrackerItem[]>([]);
  const [linkError, setLinkError] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [saveDocsOpen, setSaveDocsOpen] = useState(false);
  const [pullRequest, setPullRequest] = useState<SessionPullRequest | undefined>(
    session.organization?.pullRequest,
  );
  // "PR #12 is not merged. Mark Done anyway?"
  const [prNotMerged, setPrNotMerged] = useState<SessionPullRequest | null>(null);
  const [sendFailure, setSendFailure] = useState<SendFailureState | null>(null);
  // The doc passages that "@docs" gave to the agent, for each run.
  const [docPassages, setDocPassages] = useState<Record<string, DocPassage[]>>({});
  const [mentionActive, setMentionActive] = useState(0);
  // The position of the "@" that the user closed with Escape. That picker stays closed.
  const [mentionClosed, setMentionClosed] = useState<number | null>(null);
  const [caret, setCaret] = useState(0);
  const mentionListId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contexts, setContexts] = useState<ConversationContext[]>(draft?.contexts || []);
  const [prompt, setPrompt] = useState(draft?.prompt ?? (session.initialPrompt || ''));
  const reportDraft = useRef(onDraftChange);
  reportDraft.current = onDraftChange;
  useEffect(() => {
    reportDraft.current?.(prompt || contexts.length ? { prompt, contexts } : null);
  }, [prompt, contexts]);
  // A new chat from the project Overview starts with the model that its composer chose.
  const [model, setModel] = useState(() =>
    session.projectId && !session.forkFrom ? takeNextChatModel(session.agent) : '',
  );
  const modelAgent = useRef(session.agent);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsFailed, setModelsFailed] = useState(false);
  // The linked task is Done. The changes row then shows only for new changes.
  const [taskDone, setTaskDone] = useState(false);
  const [reviewChanges, setReviewChanges] = useState(0);
  const [reviewPath, setReviewPath] = useState<string>();
  const review = (path?: string) => {
    setReviewPath(path);
    setReviewChanges((n) => n + 1);
  };
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskNotice, setTaskNotice] = useState('');
  const [uncommitted, setUncommitted] = useState(0);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitIntent, setCommitIntent] = useState<'commit' | 'pull-request'>('commit');
  const taskUpdates = useRef(Promise.resolve());
  const startedTasks = useRef(new Set<string>());
  function syncStartedTask(next: ChatRun) {
    if (next.taskExecution) {
      setTaskNotice(
        next.taskExecution.message ||
          {
            confirmed: 'Task status confirmed on GitHub.',
            pending: 'Waiting for the agent before updating task status.',
            writing: 'Updating the task status on GitHub…',
            blocked: 'Kalkidan cannot update the task status. Change it on the board.',
            'unknown-outcome': 'Kalkidan cannot confirm the task status. Check the board.',
          }[next.taskExecution.sync],
      );
      return;
    }
    if (
      !taskId ||
      startedTasks.current.has(next.id) ||
      next.error ||
      !next.sessionReady ||
      !['running', 'completed'].includes(next.status)
    )
      return;
    startedTasks.current.add(next.id);
    taskUpdates.current = taskUpdates.current.then(async () => {
      try {
        await changeTaskStatus(api, projectGroup, taskId, 'progress');
        setTaskNotice('Task moved to In progress.');
        completed.current();
      } catch (e) {
        setTaskNotice(
          'Task status could not be updated: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
    });
  }
  /** Saves organization changes when the chat has an ID. A draft chat saves them later. */
  function saveOrganization(changes: Parameters<API['updateSession']>[2]) {
    const id = providerSession.current || (!session.projectId ? session.id : null);
    return id ? api.updateSession(session.agent, id, changes) : Promise.resolve();
  }
  /** Saves the pull request and moves the linked task to the review status of the board. */
  function pullRequestOpened(next: SessionPullRequest) {
    setPullRequest(next);
    void saveOrganization({ pullRequest: next })
      .then(() => completed.current())
      .catch((e) => setError('Could not save the pull request on the chat: ' + errorMessage(e)));
    if (!taskId || !projectGroup) return;
    taskUpdates.current = taskUpdates.current.then(async () => {
      try {
        const name = await moveTaskToReview(api, projectGroup, taskId);
        if (name) {
          setTaskNotice(`Task moved to ${name}.`);
          completed.current();
        }
      } catch (e) {
        setTaskNotice('Task status could not be updated: ' + errorMessage(e));
      }
    });
  }
  /** Reads the pull request state again. Returns the current value. */
  async function refreshPullRequest(current = pullRequest) {
    if (!current || !repositoryId || !api.pullRequestStatus) return current;
    const status = await api.pullRequestStatus(repositoryId, current.url);
    const next = { ...current, state: status.state, number: status.number || current.number };
    if (next.state !== current.state || next.number !== current.number) {
      setPullRequest(next);
      void saveOrganization({ pullRequest: next }).catch(() => {
        /* The chip shows the new state. The next read saves it again. */
      });
    }
    return next;
  }
  /**
   * Checks the pull request and the uncommitted changes first. The user can open the pull
   * request, commit the changes or continue.
   */
  async function requestDone(options: { skipPullRequest?: boolean } = {}) {
    setPrNotMerged(null);
    if (pullRequest && !options.skipPullRequest) {
      setTaskBusy(true);
      let current = pullRequest;
      try {
        current = (await refreshPullRequest()) || pullRequest;
      } catch {
        /* Use the saved state. */
      } finally {
        setTaskBusy(false);
      }
      if (current.state !== 'merged') {
        setPrNotMerged(current);
        return;
      }
    }
    if (repositoryId && api.workingStatus) {
      setTaskBusy(true);
      try {
        const status = await api.workingStatus(repositoryId);
        const count = status.changed + status.untracked;
        if (count) {
          setUncommitted(count);
          return;
        }
      } catch (error) {
        setTaskNotice(
          'Could not inspect the checkout. Retry before marking Done: ' +
            (error instanceof Error ? error.message : String(error)),
        );
        return;
      } finally {
        setTaskBusy(false);
      }
    }
    await markDone();
  }
  async function markDone() {
    setUncommitted(0);
    setTaskBusy(true);
    try {
      await taskUpdates.current;
      await changeTaskStatus(api, projectGroup, taskId, 'done');
      setTaskDone(true);
      setTaskNotice('Task marked Done.');
      completed.current();
    } catch (e) {
      setTaskNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskBusy(false);
    }
  }
  const [taskId, setTaskId] = useState(session.task?.id || session.organization?.taskId || '');
  // The title of the linked task, for the title of a new task chat.
  const linkedTaskTitle = useRef<string | undefined>(session.task?.title);
  // A new chat counts only the files that change after it starts. The files that had changes
  // when it started are the baseline. A resumed chat counts all changed files.
  const countsFromStart = !!session.projectId && !session.forkFrom;
  const baseline = useRef<Set<string> | null>(null);
  const [newFiles, setNewFiles] = useState<number | null>(null);
  /** Reads the branch and the number of changed files of the checkout. */
  const readWorking = useRef<() => void>(() => {});
  readWorking.current = () => {
    if (!repositoryId || !api.workingStatus) return;
    api
      .workingStatus(repositoryId)
      .then((next) => {
        if (mounted.current) setWorking(next);
      })
      .catch(() => {
        // The status is not available, for example on an SSH host. The count does not show.
      });
    if (!countsFromStart || typeof api.workingFiles !== 'function') return;
    api
      .workingFiles(repositoryId)
      .then((files) => {
        if (!mounted.current) return;
        const paths = files.map((file) => file.path);
        if (!baseline.current) baseline.current = new Set(paths);
        setNewFiles(paths.filter((path) => !baseline.current!.has(path)).length);
      })
      .catch(() => {
        /* Without the file list, the chat counts all changed files. */
      });
  };
  useEffect(() => readWorking.current(), [api, repositoryId]);
  const changedFiles = working ? working.changed + working.untracked : 0;
  /** The changed files that this chat made, as far as Kalkidan can tell. */
  const chatChanges = newFiles ?? changedFiles;
  const folderName = pathBasename(session.cwd);
  // A known status with no changed files has nothing to commit. An unknown status does not
  // block the Commit dialog, because the dialog reads the status again.
  const nothingToCommit = !!working && changedFiles === 0;
  /** Opens the Commit dialog, or tells the user that there is nothing to commit. */
  function openCommit() {
    if (nothingToCommit) showToast({ message: noChangesToCommit });
    else {
      setCommitIntent('commit');
      setCommitOpen(true);
    }
  }
  /** Opens the dialog that commits the changes and creates the pull request. */
  function createPullRequest() {
    if (pullRequest) openExternal(pullRequest.url);
    else if (working && !hasBranchWork(working))
      showToast({ message: 'No changes or commits for a pull request.' });
    else {
      setCommitIntent('pull-request');
      setCommitOpen(true);
    }
  }
  // A resumed session has only the task id. Load the board to show the task title.
  useEffect(() => {
    const connection = trackerConnection(projectGroup);
    if (!taskId || !projectGroup || !connection || session.task?.title) return;
    if (linkItems.some((item) => item.id === taskId)) return;
    let current = true;
    trackerClient(api, connection.provider)
      .board(projectGroup.id)
      .then((board) => {
        if (current) setLinkItems(board.items);
      })
      .catch(() => {
        /* The badge shows "Linked task" without the title. */
      });
    return () => {
      current = false;
    };
  }, [api, projectGroup?.id, taskId]);
  useEffect(() => {
    let current = true;
    setModels([]);
    // Another agent has other models. The first read keeps the model from the Overview.
    if (modelAgent.current !== session.agent) setModel('');
    modelAgent.current = session.agent;
    setModelsFailed(false);
    api
      .models?.(session.agent)
      .then((value) => {
        if (current) setModels(value);
      })
      .catch(() => {
        if (current) setModelsFailed(true);
      });
    return () => {
      current = false;
    };
  }, [api, session.agent]);
  // Access default: a chat that works in its own branch copy (a separate folder that Kalkidan
  // made, on its own branch) can edit files, because its changes stay apart from the user's
  // checkout. Every other chat starts as Read only, also on a feature branch in the main
  // checkout, so the user's own work stays safe. The last choice in the code folder and the
  // choice in Settings › General ("New chats start as") apply when the user made one.
  const storedPermission = session.projectId ? readAccess(repositoryId) || defaultAccess() : null;
  const [allowEdits, setAllowEdits] = useState(() => storedPermission === 'edit');
  const onDefaultBranch = !!working && working.branch === working.defaultBranch;
  const onBranchCopy = !!working && !onDefaultBranch;
  const ownBranchCopy = isOwnBranchCopy(session.cwd, working);
  useEffect(() => {
    if (storedPermission || permissionTouched.current || startedTasks.current.size) return;
    // A chat that already sent a message keeps its access.
    if (messages.length) return;
    setAllowEdits(ownBranchCopy);
  }, [ownBranchCopy]);
  function choosePermission(value: ChatAccess) {
    permissionTouched.current = true;
    setAllowEdits(value === 'edit');
    setEditsRefused(false);
    if (session.projectId) saveAccess(repositoryId, value);
  }
  const [pastActivity, setPastActivity] = useState<ChatRun[]>([]);
  const finished = useRef(new Set<string>());
  const [run, setRun] = useState<ChatRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const mounted = useRef(true);
  const startingRef = useRef(false);
  const stopRequested = useRef(false);
  const runRef = useRef<ChatRun | null>(null);
  const providerSession = useRef<string | null>(null);
  // The number of messages before the first message of this chat view.
  const messagesBefore = useRef(0);
  const submitted = useRef<{
    runId: string;
    messageId: string;
    text: string;
    prompt: string;
  } | null>(null);
  // The saved policy results of this chat. They stay after a restart. A finished run with
  // policy results reads them again.
  const [savedPolicies, setSavedPolicies] = useState<PolicyRecord[]>([]);
  // The saved chat ID of the last run with policy results, and a count that reads them again.
  const [policyChat, setPolicyChat] = useState<string>();
  const [policyReads, setPolicyReads] = useState(0);
  useEffect(() => {
    const id = policyChat || session.id;
    if (!api.chatPolicyResults || id.startsWith('draft-')) return;
    let current = true;
    api
      .chatPolicyResults(session.agent, id, session.hostId)
      .then((records) => {
        if (current) setSavedPolicies(addPolicyRecords([], records, chatPolicyLimit));
      })
      .catch(() => {
        /* The chat shows the results of the current run only. */
      });
    return () => {
      current = false;
    };
  }, [api, session.agent, session.id, session.hostId, policyChat, policyReads]);
  function finishRun(next: ChatRun) {
    if (finished.current.has(next.id)) return;
    finished.current.add(next.id);
    syncStartedTask(next);
    if (next.policies?.length) {
      if (next.sessionReady && next.sessionId) setPolicyChat(next.sessionId);
      setPolicyReads((count) => count + 1);
    }

    if (session.projectId && !providerSession.current && next.sessionReady && next.sessionId) {
      providerSession.current = next.sessionId;
      if (taskId || pullRequest || session.organization)
        void api
          .updateSession(session.agent, next.sessionId, {
            ...session.organization,
            ...(taskId ? { taskId } : {}),
            ...(pullRequest ? { pullRequest } : {}),
          })
          .then(() => completed.current())
          .catch((e) =>
            setError(
              'Chat saved, but its name, pin or task link could not be saved: ' + errorMessage(e),
            ),
          );
      onSessionCreated?.(
        next.sessionId,
        // A task chat has the task title. Other chats take the first line of the message, not
        // the attached context.
        (taskId && linkedTaskTitle.current) ||
          mentionPlainText(submitted.current?.prompt || '')
            .trim()
            .split('\n', 1)[0]
            .slice(0, 100) ||
          session.title,
      );
    }
    // A draft that did not save keeps its outcome in memory only, for its status dot. A refused
    // launch is never saved as a chat.
    if (session.id.startsWith('draft-'))
      markDraftOutcome(
        session.agent,
        session.id,
        providerSession.current ? undefined : chatOutcomeOf(next),
      );
    const sent = submitted.current?.runId === next.id ? submitted.current : null;
    // The agent did not answer: show the error under the message. The message stays in the
    // transcript, and "Try again" sends it again, so the composer does not get the text back.
    if (
      sent &&
      (next.error || next.errorCode) &&
      next.status !== 'stopped' &&
      !next.messages.some((message) => message.role === 'assistant')
    ) {
      setSendFailure({
        messageId: sent.messageId,
        text: sent.text,
        prompt: sent.prompt,
        error:
          next.errorCode === 'managed_launch_blocked' && next.error
            ? managedLaunchError(launchFailure(next), {
                computer,
                hostId: session.hostId,
                agent: session.agent,
                regionSaved: !!account?.region,
                signedIn: account?.phase === 'authenticated',
              })
            : agentErrorMessage(`${next.error || ''} ${next.errorCode || ''}`, session.agent, {
                regionSaved: !!account?.region,
                signedIn: account?.phase === 'authenticated',
              }),
      });
      if (!providerSession.current && !messagesBefore.current)
        onTitleChange?.(sent.prompt.trim().split('\n', 1)[0].slice(0, 100));
    } else if (next.error) setError(next.error);
    if (!runEdits.current && next.status !== 'stopped' && refusedWrite(next)) setEditsRefused(true);
    setRunsFinished((n) => n + 1);
    readWorking.current();
    completed.current();
  }
  const completed = useRef(onComplete);
  completed.current = onComplete;
  const active = starting || run?.status === 'running';
  const agentName = agentLabel(session.agent);
  const modelOptions = useModelChoice(api, session.agent, models, agentName);
  // While nobody is signed in, Send starts the sign-in. The draft stays in the composer and
  // sends after the sign-in, so no failed chat shows in the sidebar.
  const { status: account } = useVerdictanStatus(api, open);
  const signedOut =
    !!account &&
    (account.phase === 'signed-out' ||
      account.phase === 'missing' ||
      account.phase === 'expired' ||
      (account.phase === 'error' && account.error === 'desktop.region_required'));
  const sendAfterSignIn = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let current = true;
    (session.projectId && !session.forkFrom
      ? Promise.resolve({ messages: [], truncated: false })
      : api.transcript(session.agent, session.forkFrom || session.id)
    )
      .then((value) => {
        if (current) {
          setMessages(value.messages);
          setTruncated(value.truncated);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      mounted.current = false;
    };
  }, [api, session.agent, session.id]);
  useEffect(() => {
    if (!run || (run.status !== 'running' && (!run.governance || run.governance.finalized))) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.chatStatus(run!.id);
        if (cancelled) return;
        runRef.current = next;
        syncStartedTask(next);
        setRun(next);
        if (next.status !== 'running' && (!next.governance || next.governance.finalized)) {
          finishRun(next);
          return;
        }
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      }
      if (!cancelled) timer = setTimeout(poll, 400);
    }
    timer = setTimeout(poll, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, run?.id, run?.status, run?.governance?.finalized]);
  // A run that continued on the SSH host while this chat was closed: attach to it again.
  useEffect(() => {
    const id = session.liveRunId;
    if (!id || runRef.current || startingRef.current) return;
    let current = true;
    api
      .chatStatus(id)
      .then((next) => {
        if (!current || runRef.current || startingRef.current || next.status !== 'running') return;
        runRef.current = next;
        setRun(next);
      })
      .catch(() => {
        // The run ended. The chat shows its saved transcript and outcome.
      });
    return () => {
      current = false;
    };
  }, [api, session.liveRunId]);
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, run, loading, open]);
  // An approval and a question are two states: the shell names them in notifications.
  const approvalsPending = (run?.approvals || []).filter((a) => a.status === 'pending').length;
  const questionsPending = (run?.requests || []).filter((r) => r.status === 'pending').length;
  const activity: SessionActivityState | null = approvalsPending
    ? 'approval'
    : questionsPending
      ? 'question'
      : active
        ? 'running'
        : null;
  useEffect(() => {
    onActivityChange(activity);
    return () => onActivityChange(null);
  }, [activity, onActivityChange]);
  /**
   * Sends the composer text. `allowEdits` sends the last message again with other permissions.
   * `resend` sends a message that failed.
   */
  async function send(retry?: { allowEdits?: boolean; resend?: { text: string; prompt: string } }) {
    const again = retry ? retry.resend || submitted.current : null;
    // "Sign in to send" always starts the sign-in. A draft then sends after the sign-in.
    if (signedOut && !retry) {
      sendAfterSignIn.current = !!prompt.trim();
      startSignIn();
      return;
    }
    if (retry ? !again : !prompt.trim()) return;
    // A message while an approval waits is the answer "do this instead": deny the request,
    // stop the turn, then send the message.
    if (!retry && run && active && approvalsPending && !readOnly) {
      const id = run.id;
      sendWhenIdle.current = true;
      await Promise.all(
        (run.approvals || [])
          .filter((approval) => approval.status === 'pending')
          .map((approval) => api.chatApprove(id, approval.id, false)),
      ).catch((e) => setError(errorMessage(e)));
      await api.chatStop(id).catch(() => {
        /* The turn can end by itself after the denial. */
      });
      return;
    }
    if (active || taskBusy || startingRef.current || loading || readOnly) return;
    if (signedOut) {
      sendAfterSignIn.current = true;
      startSignIn();
      return;
    }
    const edits = retry?.allowEdits ?? allowEdits;
    const text = again
      ? again.text
      : [prompt, ...contexts.map((context) => context.text)].join('\n\n');
    if (text.length > 100000) {
      setError(
        'Message and context exceed 100,000 characters. Remove an attachment or shorten the message.',
      );
      return;
    }
    const sentPrompt = again?.prompt ?? prompt;
    const sentContexts = again ? [] : contexts;
    /** The transcript has the message now, so it leaves the composer. */
    const clearComposer = () => {
      // "Allow edits and retry" sends the last message again. The composer can have a new draft.
      if (again && !retry?.resend) return;
      setPrompt((current) => composerAfterSubmit(current, sentPrompt));
      if (!again) setContexts((current) => contextsAfterSubmit(current, sentContexts));
    };
    // A new message replaces a failed one. "Try again" sends the failed message again.
    if (sendFailure) {
      const failed = sendFailure.messageId;
      setMessages((existing) => existing.filter((message) => message.id !== failed));
      setSendFailure(null);
    }
    stopRequested.current = false;
    startingRef.current = true;
    setStarting(true);
    setError('');
    setTaskNotice('');
    setEditsRefused(false);
    setMentionClosed(null);
    runEdits.current = edits;
    if (!providerSession.current) messagesBefore.current = messages.length;
    /** Moves the messages of the last run into the history, before a new message. */
    const previousMessages = () => {
      const previous = runRef.current;
      if (previous && (previous.tools?.length || previous.diff))
        setPastActivity((list) => [...list.slice(-19), previous]);
      return (previous?.messages || []).map((message) => ({
        ...message,
        id: previous!.id + ':' + message.id,
      }));
    };
    try {
      const signature = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(
              JSON.stringify([text, edits, model, taskId, session.forkFrom, session.forkOf]),
            ),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      const key = `kalkidan-send:${session.hostId || 'local'}:${session.agent}:${session.id}`;
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      const operationId = saved?.signature === signature ? saved.id : crypto.randomUUID();
      localStorage.setItem(key, JSON.stringify({ id: operationId, signature }));
      const next =
        session.projectId && !providerSession.current
          ? await api.chatCreate(session.projectId, session.agent, text, edits, {
              operationId,
              forkFrom: session.forkFrom,
              ...(session.forkOf ? { forkOf: session.forkOf, forkUntil: session.forkUntil } : {}),
              model: chosenModel(modelOptions, model) || undefined,
              taskId: taskId || undefined,
            })
          : await api.chatStart(session.agent, providerSession.current || session.id, text, edits, {
              operationId,
              model: chosenModel(modelOptions, model) || undefined,
              taskId: taskId || undefined,
            });
      localStorage.removeItem(key);
      if (stopRequested.current) await api.chatStop(next.id);
      if (!mounted.current) return;
      const moved = previousMessages();
      const messageId = crypto.randomUUID();
      submitted.current = { runId: next.id, messageId, text, prompt: sentPrompt };
      setMessages((existing) => [...existing, ...moved, { id: messageId, role: 'user', text }]);
      syncStartedTask(next);
      clearComposer();
      // Show the doc passages that "@docs" gives to the agent. The search is the same.
      const query = docsQuery(text);
      if (query && projectGroup && api.docsSearch)
        void api
          .docsSearch(projectGroup.id, query, 3)
          .then((passages) =>
            setDocPassages((current) => ({ ...current, [next.id]: passages.slice(0, 3) })),
          )
          .catch(() => {
            /* The answer shows without the passage chips. */
          });
      runRef.current = next;
      setRun(next);
      follow.current = true;
      if (next.status !== 'running') finishRun(next);
    } catch (e) {
      if (!mounted.current) return;
      // The message did not reach the agent. Show it with the error under it. "Try again" sends
      // it again and "Change agent" starts a chat with it, so it leaves the composer.
      const moved = previousMessages();
      runRef.current = null;
      setRun(null);
      const messageId = crypto.randomUUID();
      setMessages((existing) => [...existing, ...moved, { id: messageId, role: 'user', text }]);
      setSendFailure({
        messageId,
        text,
        prompt: sentPrompt,
        error: agentErrorMessage(e, session.agent, {
          regionSaved: !!account?.region,
          signedIn: account?.phase === 'authenticated',
        }),
      });
      clearComposer();
      follow.current = true;
      if (session.projectId && !providerSession.current && !messagesBefore.current)
        onTitleChange?.(mentionPlainText(sentPrompt).trim().split('\n', 1)[0].slice(0, 100));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }
  // Send the message that answered a waiting approval, after the turn ends.
  const sendWhenIdle = useRef(false);
  useEffect(() => {
    if (active || !sendWhenIdle.current) return;
    sendWhenIdle.current = false;
    void send();
  }, [active]);
  // Send the kept draft after the sign-in.
  useEffect(() => {
    if (account?.phase !== 'authenticated' || !sendAfterSignIn.current) return;
    sendAfterSignIn.current = false;
    void send();
  }, [account?.phase]);
  /** Sends the failed message again. */
  function retrySend() {
    const failed = sendFailure;
    if (!failed) return;
    void send({ resend: { text: failed.text, prompt: failed.prompt } });
  }
  /** Starts a new chat with the other agent, with the same message and task. */
  function changeAgent() {
    const failed = sendFailure;
    const other = agentCatalog.find((agent) => agent.id !== session.agent)?.id;
    dispatchApp('kalkidan-new-session', {
      groupId: projectGroup?.id,
      repoId: repositoryId,
      agent: other,
      prompt: failed?.prompt || prompt,
      taskId: taskId || undefined,
    });
  }
  async function stop() {
    stopRequested.current = true;
    if (!run) return;
    try {
      await api.chatStop(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function openTaskLink() {
    if (!projectGroup || !trackerConnection(projectGroup)) return;
    setLinkOpen(true);
    setLinkLoading(true);
    setLinkError('');
    try {
      setLinkItems(
        (await trackerClient(api, trackerConnection(projectGroup)?.provider).board(projectGroup.id))
          .items,
      );
    } catch (e) {
      setLinkError(errorMessage(e));
    } finally {
      setLinkLoading(false);
    }
  }
  async function saveTaskLink(choice: string, created?: TrackerItem) {
    await saveOrganization({ taskId: choice });
    if (created) setLinkItems((items) => [...items.filter((i) => i.id !== created.id), created]);
    setTaskId(choice);
    setTaskDone(false);
    setTaskNotice('');
    completed.current();
    const groupId = projectGroup?.id;
    if (created && groupId)
      showToast({
        message: `Made the task “${created.title}” and linked it to this chat.`,
        actions: [{ label: 'Open task', onClick: () => openTask(groupId, created.id) }],
      });
  }
  /** Opens the task sheet of the linked task on the project Tasks page. */
  function openLinkedTask() {
    if (projectGroup && taskId) openTask(projectGroup.id, taskId);
  }
  // A session on an SSH host fails when the host disconnects. Offer to connect again.
  const [reconnecting, setReconnecting] = useState(false);
  const hostError =
    !!session.hostId &&
    !!error &&
    /host|ssh|disconnect|not connected|connection|ECONNRESET|EPIPE|timed out/i.test(error);
  // Saved results and the results of the current run, without copies, oldest first.
  const shownPolicies = addPolicyRecords(savedPolicies, run?.policies || [], chatPolicyLimit);
  const latestRunPolicy = run?.policies?.length
    ? [...shownPolicies]
        .reverse()
        .find((policy) =>
          run.policies!.some((own) => own.at === policy.at && own.requestId === policy.requestId),
        )
    : undefined;
  // Desktop codes and agent errors show as plain words with an action.
  const errorInfo: AgentError | null = error
    ? run?.errorCode === 'managed_launch_blocked' && run.error === error
      ? managedLaunchError(launchFailure(run), {
          computer,
          hostId: session.hostId,
          agent: session.agent,
          regionSaved: !!account?.region,
          signedIn: account?.phase === 'authenticated',
        })
      : /\bdesktop\.[a-z_]+|verdictan is not ready/i.test(error) ||
          error.startsWith(managedOnlyNotice)
        ? agentErrorMessage(error, session.agent, {
            regionSaved: !!account?.region,
            signedIn: account?.phase === 'authenticated',
          })
        : { message: errorMessage(error) }
    : null;
  async function reconnect() {
    if (!session.hostId) return;
    setReconnecting(true);
    try {
      const host = await api.remoteConnect(session.hostId);
      if (host.error) throw new Error(host.error);
      setError('');
      readWorking.current();
      completed.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReconnecting(false);
    }
  }
  async function attachDoc(doc: { id: string; title: string }, groupId = projectGroup?.id) {
    if (!groupId) return;
    try {
      const page = await api.docsRead(groupId, doc.id);
      const title = page.title || doc.title || 'Untitled';
      setContexts((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          label: `Doc: ${title}`,
          text: `Project doc page "${title}" (from the project docs):\n${page.markdown}`.slice(
            0,
            interfaceConfig.attachmentCharacters,
          ),
        },
      ]);
    } catch (e) {
      setError('Could not attach the doc page: ' + errorMessage(e));
    }
  }
  /** Reads the doc pages for the "+" menu. */
  async function loadRecentPages() {
    if (!projectGroup || typeof api.docsMetadata !== 'function') return;
    try {
      const pages = await api.docsMetadata(projectGroup.id);
      setRecentPages(pages.slice(0, recentPageLimit));
    } catch {
      setRecentPages([]);
    }
  }
  /** Attaches text files from the computer to the message. */
  async function attachFiles(files: FileList | null) {
    for (const file of Array.from(files || [])) {
      if (contexts.length >= interfaceConfig.maxAttachments) break;
      const text = await file.text().catch(() => null);
      if (text === null || text.includes('\u0000')) {
        showToast({ message: `Kalkidan can attach text files only. “${file.name}” is not text.` });
        continue;
      }
      setContexts((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          label: file.name,
          text: `File "${file.name}" (attached by the user):\n${text}`.slice(
            0,
            interfaceConfig.attachmentCharacters,
          ),
        },
      ]);
    }
  }
  const sendOnOpen = useRef(false);
  useEffect(() => {
    if (!sendOnOpen.current || loading || !prompt.trim()) return;
    sendOnOpen.current = false;
    void send();
  }, [prompt, loading]);
  // A page that starts a chat leaves a draft: the text, doc pages and a task to link.
  useEffect(() => {
    const pending = takePendingDraft(`${session.agent}:${session.id}`);
    if (!pending) return;
    if (pending.prompt) setPrompt(pending.prompt);
    // Doc pages attach after a read, so a draft with pages waits for the user to send.
    if (pending.send && pending.prompt && !pending.docIds?.length) sendOnOpen.current = true;
    if (pending.taskId) {
      setTaskId(pending.taskId);
      void saveOrganization({ taskId: pending.taskId }).catch(() => {
        /* A draft chat saves the link with the first message. */
      });
    }
    for (const id of pending.docIds || [])
      void attachDoc({ id, title: '' }, pending.groupId || projectGroup?.id);
    requestAnimationFrame(() => textarea.current?.focus());
  }, []);
  // The open pull request can merge or close on GitHub. Read its state again.
  useEffect(() => {
    if (!pullRequest?.url || pullRequest.state === 'merged') return;
    refreshPullRequest().catch(() => {
      /* The chip keeps the saved state. */
    });
  }, [pullRequest?.url, repositoryId]);
  // A classic scrollbar (Windows, Linux) takes width on the right of the messages only. The
  // CSS subtracts it from the right padding, so messages and composer share one column.
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () =>
      panel.current?.style.setProperty(
        '--scrollbar-width',
        `${Math.max(0, element.offsetWidth - element.clientWidth)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const empty = !loading && !messages.length && !run;
  const liveStep = !!run?.tools?.some((tool) => tool.status === 'inProgress');
  // Every new or empty chat puts the cursor in the composer, so the user can type at once. A
  // dialog that opened the chat (for example the task sheet) closes first, so wait for it.
  const focusedEmpty = useRef(false);
  useEffect(() => {
    if (!empty || !open || !titlebarVisible || focusedEmpty.current) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const active = document.activeElement;
      const typing =
        active !== textarea.current &&
        !!active?.matches('input, textarea, select, [contenteditable="true"]');
      if (document.querySelector('[role="dialog"], [role="alertdialog"]') && tries++ < 20) {
        timer = setTimeout(attempt, 100);
        return;
      }
      focusedEmpty.current = true;
      if (!typing) textarea.current?.focus();
    };
    timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [empty, open, titlebarVisible]);
  // A start can wait for a keychain prompt, for example while the runtime saves its access.
  const nextActivity =
    starting && account?.keychainWaiting
      ? keychainWaitingMessage
      : run?.activity && !run.activity.startsWith('message:')
        ? run.activity
        : `${agentName} is responding…`;
  // The status poll runs every 400 ms. Keep the announced text until it really changes.
  const [activityText, setActivityText] = useState(nextActivity);
  if (active && activityText !== nextActivity) setActivityText(nextActivity);
  const linkedTask = linkItems.find((i) => i.id === taskId) || session.task;
  // A new task chat takes the title of its task, not "New … chat".
  const knownTaskTitle = linkedTask?.title;
  linkedTaskTitle.current = knownTaskTitle;
  useEffect(() => {
    if (!knownTaskTitle || !session.id.startsWith('draft-') || providerSession.current) return;
    if (!/^New( .*)? (session|chat)$/.test(session.title)) return;
    onTitleChange?.(knownTaskTitle.slice(0, 100));
  }, [knownTaskTitle, session.id]);
  const sessionTitle = session.organization?.title || session.title;
  const attachReason = active
    ? 'Wait for the response'
    : contexts.length >= interfaceConfig.maxAttachments
      ? 'Remove an attachment first'
      : '';
  const canMarkDoneRef = useRef(false);
  // The application menu and the chat menu send these commands to the visible chat.
  const commands = useRef<(name: string) => boolean>(() => false);
  commands.current = (name) => {
    if (name === 'session-commit' && repositoryId) openCommit();
    else if (name === 'save-to-docs' && projectGroup) setSaveDocsOpen(true);
    else if (name === 'open-linked-task' && taskId && projectGroup) openLinkedTask();
    else if (name === 'link-task' && trackerConnection(projectGroup) && !active)
      void openTaskLink();
    else if (name === 'open-pull-request' && pullRequest) openExternal(pullRequest.url);
    else if (name === 'session-mark-task-done' && canMarkDoneRef.current) void requestDone();
    // The task sheet sends "create-pull-request". The chat menus send the session command.
    else if (
      (name === 'session-create-pull-request' || name === 'create-pull-request') &&
      repositoryId
    )
      createPullRequest();
    else return false;
    return true;
  };
  const visible = open && titlebarVisible;
  useEffect(() => {
    if (!visible) return;
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; handled?: boolean }>).detail;
      if (detail?.command && commands.current(detail.command)) detail.handled = true;
    };
    window.addEventListener('kalkidan-session-command', command);
    // Run a command that arrived before this view was visible. The Changes tool reads its
    // own commands, so this view opens it only for a queued command.
    const queued = takeQueuedSessionCommand();
    const timer = queued
      ? setTimeout(() => {
          if (queued === 'session-changes') review();
          else if (queued === 'session-terminal') showTool('terminal');
          else commands.current(queued);
        })
      : undefined;
    return () => {
      clearTimeout(timer);
      window.removeEventListener('kalkidan-session-command', command);
    };
  }, [visible]);
  const allMessages = [
    ...messages,
    ...(run?.messages || []).map((message) => ({ ...message, id: run!.id + ':' + message.id })),
  ];
  // The activity of each run goes right after the last message of that run. A run without a
  // message in this view shows after the messages.
  const runs = [...pastActivity, ...(run ? [run] : [])];
  const answered = runsFinished > 0 || messages.some((message) => message.role === 'assistant');
  const activityAfter = new Map<string, ChatRun[]>();
  const unplaced: ChatRun[] = [];
  for (const entry of runs) {
    const last = [...allMessages]
      .reverse()
      .find((message) => message.id.startsWith(entry.id + ':'));
    if (last) activityAfter.set(last.id, [...(activityAfter.get(last.id) || []), entry]);
    else unplaced.push(entry);
  }
  // The facts and pages that the chat read. They go behind the line of the last run.
  const contextUsage = useContextUsage(
    api,
    projectGroup?.id,
    session.agent,
    providerSession.current || (session.projectId ? '' : session.id),
    runsFinished,
  );
  const showContext = !!contextUsage && answered && !active;
  const lastRun = runs.at(-1);
  const activityOf = (entry: ChatRun) => (
    <AgentActivity
      key={'activity:' + entry.id}
      run={entry}
      groupId={projectGroup?.id}
      taskId={taskId || undefined}
      docPassages={docPassages[entry.id]}
      context={showContext && entry === lastRun ? contextUsage : undefined}
    />
  );
  const lastAnswer =
    [...allMessages].reverse().find((message) => message.role === 'assistant')?.text || '';
  const firstMessage = allMessages.find((message) => message.role === 'user')?.text || prompt || '';
  const mentionAt = projectGroup && !active ? activeMention(prompt, caret) : null;
  const pickerOpen = !!mentionAt && mentionAt.start !== mentionClosed;
  const mentionSources = useMentionSources({
    api,
    projectGroup,
    cwd: session.cwd,
    hostId: session.hostId,
    chats: mentionChats,
    enabled: pickerOpen,
  });
  const pickerSections =
    pickerOpen && mentionAt
      ? mentionSections(mentionAt.query, !prompt.slice(0, mentionAt.start).trim(), mentionSources)
      : [];
  const mentionOptions = flatOptions(pickerSections);
  const mentionIndex = Math.min(mentionActive, Math.max(0, mentionOptions.length - 1));
  const draftMentions = projectGroup ? parseMentions(prompt) : [];
  /** Moves the caret after a change of the text. */
  function placeCaret(position: number) {
    setCaret(position);
    pendingCaret.current = position;
  }
  // Move the caret in the same commit as the new text, before the next key press.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCaret.current;
    if (position === null || !textarea.current) return;
    pendingCaret.current = null;
    textarea.current.focus();
    textarea.current.setSelectionRange(position, position);
  }, [prompt]);
  function pickMention(option: (typeof mentionOptions)[number]) {
    if (!mentionAt) return;
    const next = insertMention(prompt, mentionAt.start, caret, option.insert);
    setPrompt(next.text);
    setMentionActive(0);
    placeCaret(next.caret);
  }
  const linkTaskAvailable = !!trackerConnection(projectGroup) && !taskId;
  // An approval or a question docks above the composer.
  const waiting = !!run && run.status === 'running' && !!(approvalsPending || questionsPending);
  // One changes row after a run: "3 files +70 −2", Review and one action. It is the one way to
  // the Changes pane. A branch with commits and no pull request also offers the pull request.
  // Commit only and Mark task done are in the chat menu.
  const unsharedCommits =
    onBranchCopy && !pullRequest && !!working && working.ahead > 0 ? working.ahead : 0;
  const lines = runLineCounts(runs);
  // A task is done only after a run that finished, or when it has a pull request. A run that
  // failed or was stopped does not offer "Mark task done".
  const canMarkDone =
    !!taskId && !taskDone && (!!pullRequest || runs.at(-1)?.status === 'completed');
  canMarkDoneRef.current = canMarkDone && !taskBusy;
  const showChanges =
    !active &&
    !!repositoryId &&
    (chatChanges > 0 || unsharedCommits > 0 || (!!pullRequest && pullRequest.state !== 'merged'));
  // The chat menu shows "Mark task done" only when the chat can mark it.
  useEffect(() => {
    if (!visible) return;
    reportChatMenuState({ canMarkDone: canMarkDone && !taskBusy });
  }, [visible, canMarkDone, taskBusy]);
  // A merged pull request finishes the linked task.
  const closedOnMerge = useRef('');
  useEffect(() => {
    if (pullRequest?.state !== 'merged' || !taskId || taskDone) return;
    if (closedOnMerge.current === pullRequest.url) return;
    closedOnMerge.current = pullRequest.url;
    void markDone();
  }, [pullRequest?.state, pullRequest?.url, taskId, taskDone]);
  // A new chat shows its code folder and branch. Another folder starts a new chat there.
  const folderPill =
    !!session.projectId && !messages.length && !run && !providerSession.current && !!repositoryId;
  const folderLabel = working ? `${folderName} · ${working.branch}` : folderName;
  function switchFolder(repoId: string) {
    if (repoId === repositoryId) return;
    dispatchApp('kalkidan-close-chat', { agent: session.agent, id: session.id });
    dispatchApp('kalkidan-new-session', {
      groupId: projectGroup?.id,
      repoId,
      agent: session.agent,
      prompt,
      taskId: taskId || undefined,
    });
  }
  /** Puts "@docs " at the start of the message. The agent then gets the matching passages. */
  function searchDocs() {
    const next = docsQuery(prompt) || /^\s*@docs\b/i.test(prompt) ? prompt : `@docs ${prompt}`;
    setPrompt(next);
    placeCaret(next.length);
  }
  /** Types "@" at the caret, so the mention picker opens. */
  function startMention() {
    const at = Math.min(caret, prompt.length);
    const before = prompt.slice(0, at);
    const insert = before && !/\s$/.test(before) ? ' @' : '@';
    setPrompt(before + insert + prompt.slice(at));
    setMentionClosed(null);
    placeCaret(at + insert.length);
  }
  return (
    <ConversationTools
      reviewRequest={reviewChanges}
      reviewPath={reviewPath}
      toolRequest={toolRequest}
      branch={working ? { name: working.branch, base: working.defaultBranch } : undefined}
      runsFinished={runsFinished}
      onChangesRead={() => readWorking.current()}
      onToolChange={setToolOpen}
      visible={visible}
      remote={!!session.hostId}
      api={api}
      cwd={session.cwd}
      disabled={!!attachReason}
      disabledReason={attachReason}
      onAttach={(context) => setContexts((previous) => [...previous, context])}
    >
      <section
        ref={panel}
        className={'conversation-panel' + (empty ? ' conversation-empty' : '')}
        aria-label="Chat"
        data-tool-open={toolOpen}
      >
        <div
          className="conversation-messages"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {loading && (
            <div className="chat-loading">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Loading chat…
            </div>
          )}
          {truncated && <p className="chat-context-note">Recent messages</p>}
          {!loading && !messages.length && (
            <div className="conversation-welcome">
              <h3>{session.projectId ? 'What are we working on?' : 'Resume your chat'}</h3>
            </div>
          )}
          <div
            className="chat-log"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Chat messages"
          >
            {allMessages.map((message) => (
              <Fragment key={message.id}>
                <article className={'chat-message ' + message.role}>
                  <div className="chat-message-author">
                    {message.role === 'user' ? 'You' : agentName}
                  </div>
                  <div className="chat-markdown prose-ui" data-variant="chat">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={mentionUrl}
                      components={{
                        img: ({ alt }) => <span>[Image{alt ? `: ${alt}` : ''}]</span>,
                        a: ({ href, children }) => {
                          if (href?.startsWith('kalkidan-mention:'))
                            return <span className="chat-mention-inline">@{children}</span>;
                          const link = safeLink(href);
                          return link ? (
                            <a className="chat-link" href={link} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ) : (
                            <span className="chat-link-text">{children}</span>
                          );
                        },
                      }}
                    >
                      {message.role === 'user' ? mentionMarkdown(message.text) : message.text}
                    </Markdown>
                  </div>
                  {message.role === 'user' && <SentMentions text={message.text} />}
                </article>
                {/* The failure is a card in the column under the message, not in the bubble. */}
                {sendFailure?.messageId === message.id && (
                  <SendFailure
                    agentName={agentName}
                    error={sendFailure.error}
                    busy={!!active}
                    onRetry={retrySend}
                    onChangeAgent={changeAgent}
                    onFork={session.id.startsWith('draft-') ? undefined : () => forkChat(session)}
                    unsaved={!providerSession.current && session.id.startsWith('draft-')}
                  />
                )}
                {activityAfter.get(message.id)?.map(activityOf)}
              </Fragment>
            ))}
          </div>
          {unplaced.map(activityOf)}
          {/* The run without an answer in this view: the context line shows alone. */}
          {showContext && !runs.length && (
            <AgentActivity groupId={projectGroup?.id} context={contextUsage} />
          )}
          {/* One status line: waiting for the user, or what runs now. The live step already
              shows under the run line. */}
          {waiting ? (
            <div className="chat-activity" data-waiting="">
              <span className="chat-activity-dot" aria-hidden="true" />
              <span role="status">
                {run?.hostDetached
                  ? 'Waiting on SSH host'
                  : approvalsPending
                    ? 'Waiting for your approval'
                    : 'Waiting for your answer'}
              </span>
            </div>
          ) : (
            active &&
            (!liveStep || run?.hostDetached) && (
              <div className="chat-activity">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                <span role="status">
                  {run?.hostDetached ? 'Waiting on SSH host' : activityText}
                </span>
              </div>
            )
          )}
          {shownPolicies.map((policy) => (
            <PolicyResultCard
              key={`${policy.requestId || ''}:${policy.at}`}
              api={api}
              policy={policy}
              busy={!!active || starting}
              // Only the last message can go again. Results of earlier runs offer no retry.
              onRetry={
                policy === latestRunPolicy
                  ? () => void send({ allowEdits: runEdits.current })
                  : undefined
              }
            />
          ))}
          {run?.status === 'stopped' && !sendWhenIdle.current && (
            <p className="chat-context-note">Stopped</p>
          )}
        </div>
        <div className="composer-dock">
          {run && waiting && (
            <div className="request-dock">
              <RunRequests
                api={api}
                run={run}
                onUpdate={(next) => {
                  if (runRef.current?.id !== next.id) return;
                  runRef.current = next;
                  setRun(next);
                  if (next.status !== 'running') finishRun(next);
                }}
              />
            </div>
          )}
          {showChanges && (
            <div className="run-changes" role="group" aria-label="Changes from this chat">
              <FileDiff className="size-4 shrink-0" aria-hidden="true" />
              <span role="status" className="run-changes-text">
                {/* The count never shortens. */}
                <span className="run-changes-count">
                  {chatChanges > 0
                    ? plural(chatChanges, 'file')
                    : unsharedCommits > 0
                      ? `${plural(unsharedCommits, 'commit')} not in a pull request`
                      : pullRequestLabelText(pullRequest!)}
                </span>
                {chatChanges > 0 && (!!lines.added || !!lines.removed) && (
                  <span className="run-changes-lines">
                    <span className="diff-count-add">+{lines.added}</span>{' '}
                    <span className="diff-count-remove">−{lines.removed}</span>
                  </span>
                )}
              </span>
              <span className="run-changes-actions">
                {chatChanges > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={toolOpen === 'diff'}
                    onClick={() => showTool('diff', true)}
                  >
                    Review
                  </Button>
                )}
                {pullRequest ? (
                  <Button size="sm" variant="outline" onClick={() => openExternal(pullRequest.url)}>
                    {pullRequestActionLabel(pullRequest)}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="run-changes-primary"
                    onClick={createPullRequest}
                  >
                    <span className="truncate">Create pull request</span>
                  </Button>
                )}
              </span>
            </div>
          )}
          <Composer
            inputRef={textarea}
            value={prompt}
            onValueChange={(value, at) => {
              setPrompt(value);
              setCaret(at);
              setMentionActive(0);
            }}
            onSend={() => void send()}
            canSend={!!prompt.trim() && !taskBusy && !loading && !readOnly}
            enterToSend={enterToSend}
            placeholder={
              approvalsPending && waiting
                ? `Or tell ${agentName} what to do instead`
                : waiting
                  ? `${agentName} is waiting for you…`
                  : messages.length || run
                    ? 'Ask for a change'
                    : composerPlaceholderFor(agentName, session.projectId ? folderName : undefined)
            }
            inputProps={{
              readOnly,
              maxLength: 100000,
              'aria-description':
                (enterToSend
                  ? 'Press Enter to send. Press Shift+Enter for a new line.'
                  : `Press ${sendShortcut} to send. Press Enter for a new line.`) +
                (projectGroup
                  ? ' Type @ to mention a file, doc, task, memory entry or chat. Type @docs to search the project docs.'
                  : ''),
              'aria-autocomplete': projectGroup ? 'list' : undefined,
              'aria-controls': pickerOpen ? mentionListId : undefined,
              'aria-expanded': projectGroup ? pickerOpen : undefined,
              'aria-activedescendant':
                pickerOpen && mentionOptions.length
                  ? `${mentionListId}-${mentionIndex}`
                  : undefined,
              onSelect: (e) => setCaret(e.currentTarget.selectionStart ?? 0),
            }}
            onKeyDown={(event) => {
              if (pickerOpen && mentionAt && !event.nativeEvent.isComposing) {
                const count = mentionOptions.length;
                if (count && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setMentionActive((mentionIndex + step + count) % count);
                  return;
                }
                if (count && ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab')) {
                  event.preventDefault();
                  pickMention(mentionOptions[mentionIndex]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMentionClosed(mentionAt.start);
                  return;
                }
              }
              // Backspace after a mention removes the whole mention.
              if (
                event.key === 'Backspace' &&
                projectGroup &&
                !event.nativeEvent.isComposing &&
                event.currentTarget.selectionStart === event.currentTarget.selectionEnd
              ) {
                const removed = removeMentionBefore(prompt, event.currentTarget.selectionStart);
                if (removed) {
                  event.preventDefault();
                  setPrompt(removed.text);
                  placeCaret(removed.caret);
                }
              }
            }}
            header={
              <>
                {(!!draftMentions.length || !!contexts.length) && (
                  <div className="context-attachments" aria-label="Attached context">
                    {draftMentions.map((mention) => (
                      <MentionChip
                        key={mention.kind + ':' + mention.id}
                        kind={mention.kind}
                        label={mention.label}
                        onRemove={
                          active
                            ? undefined
                            : () => setPrompt((current) => removeMention(current, mention))
                        }
                      />
                    ))}
                    {contexts.map((context) => (
                      <Tag
                        key={context.id}
                        icon={<Paperclip aria-hidden="true" />}
                        title={context.label}
                        onRemove={
                          active
                            ? undefined
                            : () =>
                                setContexts((previous) =>
                                  previous.filter((item) => item.id !== context.id),
                                )
                        }
                      >
                        {context.label}
                      </Tag>
                    ))}
                  </div>
                )}
                {editsRefused && !allowEdits && !active && (
                  <div className="composer-notice" role="group" aria-label="Allow edits">
                    <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">This chat is read only. Allow edits?</span>
                    {submitted.current && (
                      <Button
                        size="sm"
                        onClick={() => {
                          choosePermission('edit');
                          void send({ allowEdits: true });
                        }}
                      >
                        Allow edits and retry
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={submitted.current ? 'outline' : 'default'}
                      onClick={() => choosePermission('edit')}
                    >
                      Allow edits
                    </Button>
                    <Hint label="Keep read only">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Keep read only"
                        onClick={() => setEditsRefused(false)}
                      >
                        <X />
                      </Button>
                    </Hint>
                  </div>
                )}
                {taskId && taskNotice && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {taskNotice}
                  </p>
                )}
                {readOnly && (
                  <ReadOnlyConversation
                    ownership={ownership}
                    onStartNew={onStartNew}
                    onFork={() => forkChat(session)}
                  />
                )}
                {errorInfo && (
                  <Alert variant="destructive" size="sm" className="max-h-32 overflow-auto">
                    <AlertDescription className="grid gap-1 text-xs whitespace-pre-wrap">
                      {errorInfo.message}
                      <AgentErrorNote note={errorInfo.note} code={errorInfo.code} />
                      {errorInfo.action && (
                        <AgentErrorActions
                          error={errorInfo}
                          onFork={
                            session.id.startsWith('draft-') ? undefined : () => forkChat(session)
                          }
                        />
                      )}
                      {hostError && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1"
                          disabled={reconnecting}
                          onClick={() => void reconnect()}
                        >
                          {reconnecting ? 'Reconnecting…' : 'Reconnect'}
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {pickerOpen && mentionAt && (
                  <MentionPicker
                    id={mentionListId}
                    sections={pickerSections}
                    active={mentionIndex}
                    anchor={textarea}
                    index={mentionAt.start}
                    filtering={!!mentionAt.query}
                    onPick={pickMention}
                    onHover={setMentionActive}
                  />
                )}
              </>
            }
            controls={
              <>
                <ComposerAddMenu
                  disabled={!!attachReason}
                  reason={attachReason}
                  onOpenChange={(value) => value && void loadRecentPages()}
                  items={[
                    ...(projectGroup
                      ? [
                          {
                            label: 'Search docs',
                            icon: <Search />,
                            shortcut: '@docs',
                            onSelect: searchDocs,
                          },
                          {
                            label: 'File or folder',
                            icon: <AtSign />,
                            shortcut: '@',
                            onSelect: startMention,
                          },
                        ]
                      : []),
                    {
                      label: 'Text file…',
                      icon: <Paperclip />,
                      onSelect: () => fileInput.current?.click(),
                    },
                    ...(linkTaskAvailable
                      ? [
                          {
                            label: 'Link a task…',
                            icon: <ListTodo />,
                            onSelect: () => void openTaskLink(),
                          },
                        ]
                      : []),
                  ]}
                >
                  {projectGroup && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <FileText />
                        Doc page
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {recentPages?.map((page) => (
                          <DropdownMenuItem key={page.id} onSelect={() => void attachDoc(page)}>
                            <FileText />
                            {page.title || 'Untitled'}
                          </DropdownMenuItem>
                        ))}
                        {!!recentPages?.length && <DropdownMenuSeparator />}
                        <DropdownMenuItem onSelect={() => setDocPickerOpen(true)}>
                          <Search />
                          All pages…
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </ComposerAddMenu>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple
                  onChange={(event) => {
                    void attachFiles(event.currentTarget.files);
                    event.currentTarget.value = '';
                  }}
                />
                {folderPill && (
                  <FolderPill
                    label={folderLabel}
                    folders={folders}
                    current={repositoryId}
                    onPick={switchFolder}
                  />
                )}
                <AccessPill
                  value={allowEdits ? 'edit' : 'read'}
                  onChange={choosePermission}
                  disabled={!!active}
                />
                <ModelChip
                  choice={modelOptions}
                  value={model}
                  onChange={setModel}
                  disabled={!!active}
                  failed={modelsFailed}
                  agent={session.agent}
                  agentName={agentName}
                  onAgentChange={
                    onAgentChange && !messages.length && !run && !providerSession.current
                      ? (next) => onAgentChange(next, taskId || undefined)
                      : undefined
                  }
                />
              </>
            }
            action={
              active ? (
                <Hint label="Stop response" className="composer-send-slot">
                  <Button
                    className="composer-send rounded-full"
                    aria-label="Stop"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => void stop()}
                  >
                    <Square className="size-3 fill-current" />
                  </Button>
                </Hint>
              ) : signedOut ? (
                <Button className="composer-send-slot" size="sm" onClick={() => void send()}>
                  <LogIn aria-hidden="true" />
                  Sign in to send
                </Button>
              ) : undefined
            }
          />
        </div>
        {projectGroup && trackerConnection(projectGroup) && (
          <TaskLinkDialog
            api={api}
            group={projectGroup}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            items={linkItems}
            loading={linkLoading}
            loadError={linkError}
            current={taskId}
            chat={{
              title: /^New( .*)? (session|chat)$/.test(sessionTitle)
                ? docsQuery(firstMessage).split('\n', 1)[0].slice(0, 120) ||
                  firstMessage.trim().split('\n', 1)[0].slice(0, 120) ||
                  sessionTitle
                : sessionTitle,
              firstMessage,
              summary: lastAnswer.slice(0, 4000),
            }}
            onSave={saveTaskLink}
          />
        )}
        <ConfirmDialog
          open={!!prNotMerged}
          title="Mark task done"
          description={
            prNotMerged?.state === 'closed'
              ? `${prNotMerged.number ? `Pull request #${prNotMerged.number}` : 'The pull request'} is closed without a merge. Mark the task done anyway?`
              : `${prNotMerged?.number ? `Pull request #${prNotMerged.number}` : 'The pull request'} is not merged. The changes are not in the default branch yet. Mark the task done anyway?`
          }
          confirmLabel="Mark task done"
          busy={taskBusy}
          onCancel={() => setPrNotMerged(null)}
          onConfirm={() => void requestDone({ skipPullRequest: true })}
        >
          <p className="text-sm">
            <Button
              type="button"
              variant="link"
              onClick={() => {
                if (prNotMerged) openExternal(prNotMerged.url);
                setPrNotMerged(null);
              }}
            >
              {pullRequestActionLabel(prNotMerged || undefined)}
            </Button>
          </p>
        </ConfirmDialog>
        <ConfirmDialog
          open={!!uncommitted}
          title="Mark task done"
          description={`${plural(uncommitted, 'file')} ${uncommitted === 1 ? 'has' : 'have'} uncommitted changes. Mark the task done anyway?`}
          confirmLabel="Mark task done"
          busy={taskBusy}
          onCancel={() => setUncommitted(0)}
          onConfirm={() => void markDone()}
        >
          <p className="text-sm">
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setUncommitted(0);
                setCommitIntent('commit');
                setCommitOpen(true);
              }}
            >
              Commit the changes first
            </Button>
          </p>
        </ConfirmDialog>
        {repositoryId && (
          <CommitDialog
            api={api}
            repositoryId={repositoryId}
            open={commitOpen}
            intent={commitIntent}
            onOpenChange={setCommitOpen}
            onCommitted={() => {
              readWorking.current();
              setRunsFinished((n) => n + 1);
            }}
            message={sessionTitle}
            sessionTitle={sessionTitle}
            summary={lastAnswer.slice(0, 2000)}
            task={taskId ? linkedTask : undefined}
            group={projectGroup}
            onTaskChange={(item) =>
              setLinkItems((items) => [...items.filter((entry) => entry.id !== item.id), item])
            }
            onPullRequest={pullRequestOpened}
          />
        )}
        {projectGroup && (
          <DocPagePicker
            api={api}
            groupId={projectGroup.id}
            open={docPickerOpen}
            onOpenChange={setDocPickerOpen}
            title="Attach a doc page"
            onPick={(doc) => {
              setDocPickerOpen(false);
              void attachDoc(doc);
            }}
          />
        )}
        {projectGroup && (
          <SaveToDocsDialog
            api={api}
            groupId={projectGroup.id}
            open={saveDocsOpen}
            onOpenChange={setSaveDocsOpen}
            chatTitle={sessionTitle}
            wholeChat={allMessages.length ? chatMarkdown(sessionTitle, agentName, allMessages) : ''}
            lastAnswer={lastAnswer}
          />
        )}
      </section>
    </ConversationTools>
  );
}
