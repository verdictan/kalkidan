import { interfaceConfig } from '../config/interface';
import { trackerConnection } from '../domain/tracker';
import { managedOnlyNotice } from '../domain/verdictan';
import { trackerClient } from '../lib/tracker-client';
import {
  ConversationTools,
  type ConversationContext,
  type ToolRequest,
} from './conversation-tools';
import { AgentActivity } from './agent-activity';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { changeTaskStatus } from '../lib/task-status';
import { agentCatalog, agentLabel } from '../config/agents';
import { ConfirmDialog } from './confirm-dialog';
import { CommitDialog } from './session-menu';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  FileDiff,
  FileText,
  Globe,
  LoaderCircle,
  Lock,
  MessageCircleQuestion,
  Paperclip,
  ShieldAlert,
  Square,
  SquareTerminal,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { errorMessage } from '../lib/errors';
import { agentErrorMessage, managedLaunchError, type AgentError } from '../lib/agent-errors';
import { takePendingDraft } from '../lib/pending-draft';
import { composerAfterSubmit, contextsAfterSubmit } from '../lib/composer-draft';
import { moveTaskToReview, pullRequestLabel, type SessionPullRequest } from '../lib/pull-request';
import type { DocPassage } from '../domain/docs';
import {
  AgentErrorActions,
  MentionSuggestions,
  PullRequestChip,
  SaveToDocsDialog,
  SendFailure,
  TaskChip,
  TaskLinkDialog,
  composerMentions,
  dispatchApp,
  mentionQuery,
  openExternal,
  openTask,
  takeQueuedSessionCommand,
} from './chat-links';
import { MoreButton } from './ui/more-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { DocPagePicker } from './doc-page-picker';
import { cn } from '../lib/utils';
import { plural } from '../lib/platform';
import type { WorkingStatus } from '../api/contracts';
import type { SessionActivityState } from './activity-dot';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
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

// The permission choice of the last new session in each repository.
const permissionKey = (repositoryId: string) => `kalkidan-session-permission:${repositoryId}`;
function readPermission(repositoryId: string | undefined) {
  if (!repositoryId) return null;
  try {
    const value = localStorage.getItem(permissionKey(repositoryId));
    return value === 'edit' || value === 'read' ? value : null;
  } catch {
    return null;
  }
}
function savePermission(repositoryId: string | undefined, value: 'edit' | 'read') {
  if (!repositoryId) return;
  try {
    localStorage.setItem(permissionKey(repositoryId), value);
  } catch {
    /* The choice applies to this session only. */
  }
}

const permissionModes = {
  read: {
    label: 'Read only',
    description: 'The agent reads files and answers. It cannot change files.',
  },
  edit: {
    label: 'Can edit files',
    description: 'The agent can change files in this folder. Review the changes before you commit.',
  },
} as const;

// Starter prompts for an empty session. A click puts the text in the composer.
const starterPrompts = [
  {
    label: 'Explain this code',
    prompt:
      'Explore this repository and explain its architecture, main entry points, and how to run and test it. Do not change files yet.',
  },
  {
    label: 'Plan a change',
    prompt:
      'Help me plan a change in this repository. First read the project conventions and tests, then ask me what I want to build.',
  },
  {
    label: 'Find an improvement',
    prompt:
      'Find one concrete reliability or performance improvement in this repository. Explain the evidence and how to verify it before you change files.',
  },
];

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
}: {
  api: API;
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
}) {
  const [toolOpen, setToolOpen] = useState(false);
  const [toolRequest, setToolRequest] = useState<ToolRequest | null>(null);
  const showTool = (kind: ToolRequest['kind']) =>
    setToolRequest((previous) => ({ kind, n: (previous?.n || 0) + 1 }));
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [working, setWorking] = useState<WorkingStatus | null>(null);
  const [runsFinished, setRunsFinished] = useState(0);
  // Show "{n} files changed" after a run in this view. A new message hides it.
  const [changesNotice, setChangesNotice] = useState(false);
  const [editsRefused, setEditsRefused] = useState(false);
  const runEdits = useRef(false);
  const permissionTouched = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
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
  const [mentionClosed, setMentionClosed] = useState(false);
  const mentionListId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contexts, setContexts] = useState<ConversationContext[]>(draft?.contexts || []);
  const [prompt, setPrompt] = useState(draft?.prompt ?? (session.initialPrompt || ''));
  const reportDraft = useRef(onDraftChange);
  reportDraft.current = onDraftChange;
  useEffect(() => {
    reportDraft.current?.(prompt || contexts.length ? { prompt, contexts } : null);
  }, [prompt, contexts]);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [reviewTask, setReviewTask] = useState(false);
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
      setReviewTask(false);
      setTaskNotice('Task marked Done.');
      completed.current();
    } catch (e) {
      setTaskNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskBusy(false);
    }
  }
  const [taskId, setTaskId] = useState(session.task?.id || session.organization?.taskId || '');
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
  };
  useEffect(() => readWorking.current(), [api, repositoryId]);
  const changedFiles = working ? working.changed + working.untracked : 0;
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
    setModel('');
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
  // A new session uses the last choice in its repository. A task session allows edits by
  // default, except on the default branch: there it starts read only, so the main checkout
  // stays clean.
  const storedPermission = session.projectId ? readPermission(repositoryId) : null;
  const [allowEdits, setAllowEdits] = useState(() =>
    storedPermission ? storedPermission === 'edit' : !!session.projectId && !!taskId,
  );
  const onDefaultBranch = !!working && working.branch === working.defaultBranch;
  const taskOnDefault = !!session.projectId && !!taskId && !storedPermission && onDefaultBranch;
  useEffect(() => {
    if (taskOnDefault && !permissionTouched.current && !startedTasks.current.size)
      setAllowEdits(false);
  }, [taskOnDefault]);
  function choosePermission(value: 'edit' | 'read') {
    permissionTouched.current = true;
    setAllowEdits(value === 'edit');
    setEditsRefused(false);
    if (session.projectId) savePermission(repositoryId, value);
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
  function finishRun(next: ChatRun) {
    if (finished.current.has(next.id)) return;
    finished.current.add(next.id);
    syncStartedTask(next);

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
        // The title comes from the message only, not from the attached context.
        submitted.current?.prompt.trim().slice(0, 100) || session.title,
      );
    }
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
            ? managedLaunchError(next.error, next.managedSetup)
            : agentErrorMessage(`${next.error || ''} ${next.errorCode || ''}`, session.agent),
      });
      if (!providerSession.current && !messagesBefore.current)
        onTitleChange?.(sent.prompt.trim().split('\n', 1)[0].slice(0, 100));
    } else if (next.error) setError(next.error);
    if (!runEdits.current && next.status !== 'stopped' && refusedWrite(next)) setEditsRefused(true);
    setRunsFinished((n) => n + 1);
    setChangesNotice(true);
    readWorking.current();
    completed.current();
  }
  const completed = useRef(onComplete);
  completed.current = onComplete;
  const active = starting || run?.status === 'running';
  const agentName = agentLabel(session.agent);
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
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, run, loading, open]);
  // An approval and a question are two states: the shell names them in notifications.
  const approvalsPending = (run?.approvals || []).filter((a) => a.status === 'pending').length;
  const questionsPending = (run?.requests || []).filter((r) => r.status === 'pending').length;
  const pendingApprovals = approvalsPending + questionsPending;
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
  const [approvalHidden, setApprovalHidden] = useState(false);
  // Show a banner when an approval request is outside the visible part of the transcript.
  useEffect(() => {
    const root = scroll.current;
    const target = root?.querySelector('[data-approval-pending]');
    if (!root || !target || !pendingApprovals) {
      setApprovalHidden(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setApprovalHidden(!entry.isIntersecting),
      { root, threshold: 0.2 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [pendingApprovals, run?.id, open]);
  function reviewApproval() {
    const target = scroll.current?.querySelector<HTMLElement>('[data-approval-pending]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  }
  /**
   * Sends the composer text. `allowEdits` sends the last message again with other permissions.
   * `resend` sends a message that failed.
   */
  async function send(retry?: { allowEdits?: boolean; resend?: { text: string; prompt: string } }) {
    const again = retry ? retry.resend || submitted.current : null;
    if (retry ? !again : !prompt.trim()) return;
    if (active || taskBusy || startingRef.current || loading) return;
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
    setReviewTask(false);
    setTaskNotice('');
    setEditsRefused(false);
    setChangesNotice(false);
    setMentionClosed(false);
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
              JSON.stringify([text, edits, model, taskId, session.forkFrom]),
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
              model: model || undefined,
              taskId: taskId || undefined,
            })
          : await api.chatStart(session.agent, providerSession.current || session.id, text, edits, {
              operationId,
              model: model || undefined,
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
        error: agentErrorMessage(e, session.agent),
      });
      clearComposer();
      follow.current = true;
      if (session.projectId && !providerSession.current && !messagesBefore.current)
        onTitleChange?.(sentPrompt.trim().split('\n', 1)[0].slice(0, 100));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }
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
    setReviewTask(false);
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
  // Desktop codes and agent errors show as plain words with an action.
  const errorInfo: AgentError | null = error
    ? run?.errorCode === 'managed_launch_blocked' && run.error === error
      ? managedLaunchError(error, run.managedSetup)
      : /\bdesktop\.[a-z_]+|verdictan is not ready/i.test(error) ||
          error.startsWith(managedOnlyNotice)
        ? agentErrorMessage(error, session.agent)
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
  // A page that starts a chat leaves a draft: the text, doc pages and a task to link.
  useEffect(() => {
    const pending = takePendingDraft(`${session.agent}:${session.id}`);
    if (!pending) return;
    if (pending.prompt) setPrompt(pending.prompt);
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
  const nextActivity =
    run?.activity && !run.activity.startsWith('message:')
      ? run.activity
      : `${agentName} is responding…`;
  // The status poll runs every 400 ms. Keep the announced text until it really changes.
  const [activityText, setActivityText] = useState(nextActivity);
  if (active && activityText !== nextActivity) setActivityText(nextActivity);
  const linkedTask = linkItems.find((i) => i.id === taskId) || session.task;
  const taskTitle = linkedTask?.title || 'Linked task';
  const sessionTitle = session.organization?.title || session.title;
  const attachReason = active
    ? 'Wait for the response'
    : contexts.length >= interfaceConfig.maxAttachments
      ? 'Remove an attachment first'
      : '';
  function unlinkTask() {
    setUnlinkOpen(false);
    const previous = taskId;
    setTaskId('');
    void saveOrganization({ taskId: '' }).catch((e) => {
      // Show the link again when the change was not saved.
      setTaskId(previous);
      setError(errorMessage(e));
    });
  }
  // The application menu and the chat menu send these commands to the visible chat.
  const commands = useRef<(name: string) => boolean>(() => false);
  commands.current = (name) => {
    if (name === 'session-commit' && repositoryId) setCommitOpen(true);
    else if (name === 'save-to-docs' && projectGroup) setSaveDocsOpen(true);
    else if (name === 'open-linked-task' && taskId && projectGroup) openLinkedTask();
    else if (name === 'link-task' && trackerConnection(projectGroup) && !active)
      void openTaskLink();
    else if (name === 'open-pull-request' && pullRequest) openExternal(pullRequest.url);
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
  const lastAnswer =
    [...allMessages].reverse().find((message) => message.role === 'assistant')?.text || '';
  const firstMessage = allMessages.find((message) => message.role === 'user')?.text || prompt || '';
  const mention = projectGroup && !mentionClosed && !active ? mentionQuery(prompt) : null;
  const mentionOptions =
    mention === null
      ? []
      : composerMentions.filter((item) => item.value.slice(1).startsWith(mention));
  function pickMention(value: string) {
    setPrompt(value + ' ');
    setMentionActive(0);
    requestAnimationFrame(() => textarea.current?.focus());
  }
  const modelName = models.find((m) => m.id === model)?.name || model;
  const mode = permissionModes[allowEdits ? 'edit' : 'read'];
  const linkTaskAvailable = !!trackerConnection(projectGroup) && !taskId;
  const showChanges = changesNotice && !active && changedFiles > 0 && !!repositoryId;
  return (
    <ConversationTools
      reviewRequest={reviewChanges}
      reviewPath={reviewPath}
      toolRequest={toolRequest}
      changeCount={repositoryId ? changedFiles : null}
      runsFinished={runsFinished}
      onChangesRead={() => readWorking.current()}
      onCommit={repositoryId ? () => setCommitOpen(true) : undefined}
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
          {truncated && (
            <p className="chat-context-note">
              Showing the most recent messages. {agentName} resumes the original session with its
              saved context.
            </p>
          )}
          {!loading && !messages.length && (
            <div className="conversation-welcome">
              <h3>{session.projectId ? 'What are we working on?' : 'Resume your chat'}</h3>
              <p>
                {session.projectId
                  ? `Plan, build, and review with ${agentName}.`
                  : 'Send a message to pick up where you left off.'}
              </p>
              {session.projectId && !prompt.trim() && (
                <div className="conversation-starters" role="group" aria-label="Starter prompts">
                  {starterPrompts.map((starter) => (
                    <Hint key={starter.label} label={starter.prompt}>
                      <Button
                        variant="chip"
                        className="bg-secondary text-secondary-foreground"
                        onClick={() => {
                          setPrompt(starter.prompt);
                          requestAnimationFrame(() => textarea.current?.focus());
                        }}
                      >
                        {starter.label}
                      </Button>
                    </Hint>
                  ))}
                </div>
              )}
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
              <article
                className={'chat-message ' + message.role}
                key={message.id}
                data-failed={sendFailure?.messageId === message.id || undefined}
              >
                <div className="chat-message-author">
                  {message.role === 'user' ? 'You' : agentName}
                </div>
                <div className="chat-markdown prose-ui" data-variant="chat">
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ alt }) => <span>[Image{alt ? `: ${alt}` : ''}]</span>,
                      a: ({ href, children }) => {
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
                    {message.text}
                  </Markdown>
                </div>
                {sendFailure?.messageId === message.id && (
                  <SendFailure
                    error={sendFailure.error}
                    busy={!!active}
                    onRetry={retrySend}
                    onChangeAgent={changeAgent}
                  />
                )}
              </article>
            ))}
          </div>
          {pastActivity.map((previous) => (
            <AgentActivity
              key={previous.id}
              api={api}
              run={previous}
              onUpdate={() => {}}
              groupId={projectGroup?.id}
              taskId={taskId || undefined}
              docPassages={docPassages[previous.id]}
              onReviewChanges={repositoryId ? review : undefined}
            />
          ))}
          {run && (
            <AgentActivity
              key={run.id}
              api={api}
              run={run}
              groupId={projectGroup?.id}
              taskId={taskId || undefined}
              docPassages={docPassages[run.id]}
              onReviewChanges={repositoryId ? review : undefined}
              onUpdate={(next) => {
                if (runRef.current?.id !== next.id) return;
                runRef.current = next;
                setRun(next);
                if (next.status !== 'running') finishRun(next);
              }}
            />
          )}
          {active && (
            <div className="chat-activity">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              <span role="status">{activityText}</span>
            </div>
          )}
          {run?.status === 'stopped' && (
            <p className="chat-context-note">Response stopped. Send another message to continue.</p>
          )}
        </div>
        <div className="composer-dock">
          {approvalHidden && (
            <div className="approval-banner" role="status">
              {approvalsPending ? (
                <ShieldAlert size={16} aria-hidden="true" />
              ) : (
                <MessageCircleQuestion size={16} aria-hidden="true" />
              )}
              <span>
                {approvalsPending
                  ? `${agentName} is waiting for your approval`
                  : `${agentName} asks a question`}
              </span>
              <Button size="sm" variant="outline" onClick={reviewApproval}>
                {approvalsPending ? 'Review' : 'Answer'}
              </Button>
            </div>
          )}
          {showChanges && (
            <div className="run-changes" role="status">
              <FileDiff className="size-3.5" aria-hidden="true" />
              <span>{plural(changedFiles, 'file')} changed</span>
              <span aria-hidden="true">·</span>
              <Button variant="chip" onClick={() => review()}>
                Review
              </Button>
              <span aria-hidden="true">·</span>
              <Button variant="chip" onClick={() => setCommitOpen(true)}>
                Commit…
              </Button>
              <Button
                variant="ghost"
                size="icon-2xs"
                className="ml-auto"
                aria-label="Hide changed files notice"
                onClick={() => setChangesNotice(false)}
              >
                <X />
              </Button>
            </div>
          )}
          <div className="conversation-composer @container/composer">
            {!!contexts.length && (
              <div className="context-attachments" aria-label="Attached context">
                {contexts.map((context) => (
                  <div key={context.id} title={context.label}>
                    <span className="truncate">{context.label}</span>
                    <Button
                      variant="ghost"
                      size="icon-2xs"
                      className="rounded-full"
                      aria-label={`Remove ${context.label}`}
                      disabled={!!active}
                      onClick={() =>
                        setContexts((previous) => previous.filter((item) => item.id !== context.id))
                      }
                    >
                      <X />
                    </Button>
                  </div>
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
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Keep read only"
                  title="Keep read only"
                  onClick={() => setEditsRefused(false)}
                >
                  <X />
                </Button>
              </div>
            )}
            {taskId && taskNotice && (
              <p role="status" className="text-xs text-muted-foreground">
                {taskNotice}
              </p>
            )}
            {taskOnDefault && !allowEdits && !messages.length && !run && (
              <p className="form-help px-2">
                You are on {working?.branch}, so this task chat starts as Read only. Your checkout
                stays clean. Allow edits when you are ready.
              </p>
            )}
            {taskId && !reviewTask && (
              <Button
                variant="chip"
                className="self-start"
                disabled={!!active || taskBusy}
                onClick={() => setReviewTask(true)}
              >
                Review task completion
              </Button>
            )}
            {taskId && reviewTask && (
              <div
                className="space-y-2 rounded-lg bg-muted p-3"
                role="group"
                aria-label="Review task completion"
              >
                <p className="text-sm font-medium">Complete this task?</p>
                <p className="text-xs text-muted-foreground">
                  Review the changes and verify the result before you mark the linked task Done.
                  {pullRequest && ` ${pullRequestLabel(pullRequest)}.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => review()}>
                    Review changes
                  </Button>
                  {pullRequest && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openExternal(pullRequest.url)}
                    >
                      Open pull request
                    </Button>
                  )}
                  {repositoryId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={taskBusy || !!active}
                      onClick={() => setCommitOpen(true)}
                    >
                      Commit changes…
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={taskBusy || !!active}
                    onClick={() => void requestDone()}
                  >
                    {taskBusy ? 'Updating…' : 'Mark task done'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={taskBusy}
                    onClick={() => setReviewTask(false)}
                  >
                    Keep working
                  </Button>
                </div>
              </div>
            )}
            {errorInfo && (
              <Alert variant="destructive" size="sm" className="max-h-32 overflow-auto">
                <AlertDescription className="grid gap-1 text-xs whitespace-pre-wrap">
                  {errorInfo.message}
                  {errorInfo.action && <AgentErrorActions error={errorInfo} />}
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
            {!!mentionOptions.length && (
              <MentionSuggestions
                id={mentionListId}
                query={mention || ''}
                active={Math.min(mentionActive, mentionOptions.length - 1)}
                onPick={pickMention}
              />
            )}
            <Textarea
              ref={textarea}
              data-composer=""
              className="max-h-[clamp(80px,20vh,180px)] min-h-8 resize-none rounded-none border-0 bg-transparent px-2 py-1 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
              aria-label="Message agent"
              aria-description={
                'Press Enter to send. Press Shift+Enter for a new line.' +
                (projectGroup ? ' Type @docs to search the project docs.' : '')
              }
              aria-autocomplete={projectGroup ? 'list' : undefined}
              aria-controls={mentionOptions.length ? mentionListId : undefined}
              aria-expanded={projectGroup ? !!mentionOptions.length : undefined}
              aria-activedescendant={
                mentionOptions.length
                  ? `${mentionListId}-${Math.min(mentionActive, mentionOptions.length - 1)}`
                  : undefined
              }
              placeholder={
                projectGroup ? 'Ask anything. Type @ to search project docs.' : 'Ask anything…'
              }
              value={prompt}
              maxLength={100000}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (!e.target.value.trimStart().startsWith('@')) setMentionClosed(false);
                setMentionActive(0);
              }}
              onKeyDown={(event) => {
                if (mentionOptions.length && !event.nativeEvent.isComposing) {
                  const index = Math.min(mentionActive, mentionOptions.length - 1);
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setMentionActive(
                      (index + step + mentionOptions.length) % mentionOptions.length,
                    );
                    return;
                  }
                  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                    event.preventDefault();
                    pickMention(mentionOptions[index].value);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMentionClosed(true);
                    return;
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
            />
            <div className="composer-actions">
              <div className="composer-settings">
                <DropdownMenu>
                  <Hint label={attachReason || 'Attach context'} disabled={!!attachReason}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="chip"
                        size="icon-sm"
                        className="w-7 px-0 has-[>svg]:px-0"
                        aria-label="Attach context"
                        disabled={!!attachReason}
                      >
                        <Paperclip />
                      </Button>
                    </DropdownMenuTrigger>
                  </Hint>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuLabel>Attach to this message</DropdownMenuLabel>
                    {projectGroup && (
                      <DropdownMenuItem onSelect={() => setDocPickerOpen(true)}>
                        <FileText />
                        Attach a doc page…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => showTool('diff')}>
                      <FileDiff />
                      Changed files…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => showTool('terminal')}>
                      <SquareTerminal />
                      Terminal output…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => showTool('browser')}>
                      <Globe />
                      Browser element…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Select
                  value={allowEdits ? 'edit' : 'read'}
                  disabled={!!active}
                  onValueChange={(value) => choosePermission(value as 'edit' | 'read')}
                >
                  <Hint label={`${mode.label}: ${mode.description}`} disabled={!!active}>
                    <SelectTrigger
                      variant="chip"
                      size="sm"
                      aria-label="Agent permissions"
                      className={cn(
                        'min-w-0',
                        // Show a warning dot when the agent can change files.
                        allowEdits &&
                          "before:size-1.5 before:shrink-0 before:rounded-full before:bg-warning before:content-['']",
                      )}
                    >
                      <SelectValue>{mode.label}</SelectValue>
                    </SelectTrigger>
                  </Hint>
                  <SelectContent align="start" className="w-72">
                    {(['read', 'edit'] as const).map((value) => (
                      <SelectItem key={value} value={value} className="h-auto items-start py-1.5">
                        <span className="grid gap-0.5">
                          <span>{permissionModes[value].label}</span>
                          <span className="text-xs whitespace-normal text-muted-foreground">
                            {permissionModes[value].description}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {model && (
                  <Button
                    variant="chip"
                    className="min-w-0 max-w-[180px]"
                    title={`Model: ${modelName}. Select to use the default model.`}
                    disabled={!!active}
                    onClick={() => setModel('')}
                  >
                    <span className="truncate">{modelName}</span>
                    <X aria-hidden="true" />
                  </Button>
                )}
                {linkTaskAvailable && (
                  <Button
                    variant="chip"
                    className="@max-[35rem]/composer:hidden"
                    disabled={!!active}
                    onClick={() => void openTaskLink()}
                  >
                    Link task
                  </Button>
                )}
                {taskId && (
                  <TaskChip
                    title={taskTitle}
                    disabled={!!active}
                    onOpen={projectGroup ? openLinkedTask : undefined}
                    onChange={
                      trackerConnection(projectGroup) ? () => void openTaskLink() : undefined
                    }
                    onUnlink={() => setUnlinkOpen(true)}
                  />
                )}
                {pullRequest && <PullRequestChip pr={pullRequest} />}
                <DropdownMenu>
                  <Hint label="More options">
                    <DropdownMenuTrigger asChild>
                      <MoreButton
                        size="sm"
                        label="More options"
                        className="rounded-full text-muted-foreground"
                        disabled={!!active}
                      />
                    </DropdownMenuTrigger>
                  </Hint>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        Model
                        <span className="ml-auto max-w-28 truncate pl-2 text-xs text-muted-foreground">
                          {model ? modelName : 'Default'}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                        <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
                          <DropdownMenuRadioItem value="">
                            {agentName} · Default
                          </DropdownMenuRadioItem>
                          {models.map((m) => (
                            <DropdownMenuRadioItem key={m.id} value={m.id} title={m.name}>
                              <span className="truncate">{m.name}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        {modelsFailed && (
                          <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            Could not load models. The default model is used.
                          </p>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {linkTaskAvailable && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void openTaskLink()}>
                          Link task…
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <span className="composer-shortcut" aria-hidden="true">
                Enter to send · Shift+Enter for new line
              </span>
              {active ? (
                <Hint label="Stop response">
                  <Button
                    className="composer-send rounded-full"
                    aria-label="Stop"
                    variant="default"
                    size="icon-sm"
                    onClick={() => void stop()}
                  >
                    <Square className="size-3" />
                  </Button>
                </Hint>
              ) : (
                <Hint label="Send (Enter)">
                  <Button
                    className="composer-send rounded-full"
                    aria-label="Send"
                    aria-keyshortcuts="Enter"
                    size="icon-sm"
                    disabled={taskBusy || !prompt.trim() || loading}
                    onClick={() => void send()}
                  >
                    <ArrowUp />
                  </Button>
                </Hint>
              )}
            </div>
          </div>
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
        <Dialog open={!!prNotMerged} onOpenChange={(value) => !value && setPrNotMerged(null)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>
                {prNotMerged?.number ? `PR #${prNotMerged.number}` : 'The pull request'} is not
                merged
              </DialogTitle>
              <DialogDescription>
                {prNotMerged?.state === 'closed'
                  ? 'The pull request is closed without a merge. Mark the task Done anyway?'
                  : 'The changes are not in the default branch yet. Mark the task Done anyway?'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPrNotMerged(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={taskBusy}
                onClick={() => void requestDone({ skipPullRequest: true })}
              >
                Mark Done anyway
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  if (prNotMerged) openExternal(prNotMerged.url);
                  setPrNotMerged(null);
                }}
              >
                Open pull request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!uncommitted} onOpenChange={(value) => !value && setUncommitted(0)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Uncommitted changes</DialogTitle>
              <DialogDescription>
                {plural(uncommitted, 'file')} {uncommitted === 1 ? 'has' : 'have'} uncommitted
                changes.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUncommitted(0)}>
                Cancel
              </Button>
              <Button variant="outline" disabled={taskBusy} onClick={() => void markDone()}>
                Mark done anyway
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  setUncommitted(0);
                  setCommitOpen(true);
                }}
              >
                Commit…
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {repositoryId && (
          <CommitDialog
            api={api}
            repositoryId={repositoryId}
            open={commitOpen}
            onOpenChange={setCommitOpen}
            onReview={() => review()}
            onCommitted={() => {
              readWorking.current();
              setRunsFinished((n) => n + 1);
            }}
            message={sessionTitle}
            sessionTitle={sessionTitle}
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
        <ConfirmDialog
          open={unlinkOpen}
          title="Unlink task"
          description="The agent no longer gets this task as context. The task stays on the board. You can link it again later."
          confirmLabel="Unlink task"
          onCancel={() => setUnlinkOpen(false)}
          onConfirm={unlinkTask}
        />
      </section>
    </ConversationTools>
  );
}
