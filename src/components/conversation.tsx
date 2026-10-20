import { interfaceConfig } from '../config/interface';
import { trackerConnection } from '../domain/tracker';
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
import { agentLabel } from '../config/agents';
import { ConfirmDialog } from './confirm-dialog';
import { CommitDialog } from './session-menu';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  FileDiff,
  FileText,
  Globe,
  LoaderCircle,
  Lock,
  Paperclip,
  ShieldAlert,
  Square,
  SquareTerminal,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Choice } from './choice';
import { Alert, AlertDescription } from './ui/alert';
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
    label: 'Can read only',
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
  const [linkChoice, setLinkChoice] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
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
          (next.taskExecution.sync === 'confirmed'
            ? 'Task status confirmed on GitHub.'
            : next.taskExecution.sync === 'pending'
              ? 'Waiting for the agent before updating task status.'
              : `Task sync: ${next.taskExecution.sync}`),
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
  /** Checks for uncommitted changes first. The user can commit them or continue. */
  async function requestDone() {
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
      if (taskId || session.organization)
        void api
          .updateSession(session.agent, next.sessionId, {
            ...session.organization,
            ...(taskId ? { taskId } : {}),
          })
          .then(() => completed.current())
          .catch((e) =>
            setError(
              'Session saved, but its name, pin, or task link could not be saved: ' + e.message,
            ),
          );
      onSessionCreated?.(
        next.sessionId,
        // The title comes from the message only, not from the attached context.
        submitted.current?.prompt.trim().slice(0, 100) || session.title,
      );
    }
    if (next.error) setError(next.error);
    if (!runEdits.current && next.status !== 'stopped' && refusedWrite(next)) setEditsRefused(true);
    setRunsFinished((n) => n + 1);
    setChangesNotice(true);
    readWorking.current();
    if (
      next.errorCode === 'session_busy' &&
      !next.messages.length &&
      submitted.current?.runId === next.id
    ) {
      const sent = submitted.current;
      setPrompt(sent.text);
      setMessages((previous) => previous.filter((message) => message.id !== sent.messageId));
      submitted.current = null;
    }
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
  const pendingApprovals =
    (run?.approvals || []).filter((a) => a.status === 'pending').length +
    (run?.requests || []).filter((r) => r.status === 'pending').length;
  const activity: SessionActivityState | null = pendingApprovals
    ? 'approval'
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
  /** Sends the composer text. A retry sends the last message again with other permissions. */
  async function send(retry?: { allowEdits: boolean }) {
    const again = retry ? submitted.current : null;
    if (retry ? !again : !prompt.trim()) return;
    if (active || taskBusy || startingRef.current || loading) return;
    const edits = retry ? retry.allowEdits : allowEdits;
    const text = again
      ? again.text
      : [prompt, ...contexts.map((context) => context.text)].join('\n\n');
    if (text.length > 100000) {
      setError(
        'Message and context exceed 100,000 characters. Remove an attachment or shorten the message.',
      );
      return;
    }
    stopRequested.current = false;
    startingRef.current = true;
    setStarting(true);
    setError('');
    setReviewTask(false);
    setTaskNotice('');
    setEditsRefused(false);
    setChangesNotice(false);
    runEdits.current = edits;
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
      if (runRef.current && (runRef.current.tools?.length || runRef.current.diff))
        setPastActivity((previous) => [...previous.slice(-19), runRef.current!]);
      const previousMessages = (runRef.current?.messages || []).map((message) => ({
        ...message,
        id: runRef.current!.id + ':' + message.id,
      }));
      const messageId = crypto.randomUUID();
      submitted.current = { runId: next.id, messageId, text, prompt: again?.prompt ?? prompt };
      setMessages((existing) => [
        ...existing,
        ...previousMessages,
        { id: messageId, role: 'user', text },
      ]);
      syncStartedTask(next);
      if (!again) {
        setPrompt('');
        setContexts([]);
      }
      runRef.current = next;
      setRun(next);
      follow.current = true;
      if (next.error) setError(next.error);
      if (next.status !== 'running') finishRun(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
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
    setLinkBusy(true);
    setLinkError('');
    setLinkChoice(taskId);
    try {
      setLinkItems(
        (await trackerClient(api, trackerConnection(projectGroup)?.provider).board(projectGroup.id))
          .items,
      );
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  }
  async function saveTaskLink() {
    setLinkBusy(true);
    setLinkError('');
    try {
      const id = providerSession.current || (!session.projectId ? session.id : null);
      if (id) await api.updateSession(session.agent, id, { taskId: linkChoice });
      setTaskId(linkChoice);
      setReviewTask(false);
      setTaskNotice('');
      setLinkOpen(false);
      completed.current();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  }
  // A session on an SSH host fails when the host disconnects. Offer to connect again.
  const [reconnecting, setReconnecting] = useState(false);
  const hostError =
    !!session.hostId &&
    !!error &&
    /host|ssh|disconnect|not connected|connection|ECONNRESET|EPIPE|timed out/i.test(error);
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
  async function attachDoc(doc: { id: string; title: string }) {
    if (!projectGroup) return;
    try {
      const page = await api.docsRead(projectGroup.id, doc.id);
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
      setError('Could not attach the doc page: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
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
    const id = providerSession.current || (!session.projectId ? session.id : null);
    if (id)
      void api.updateSession(session.agent, id, { taskId: '' }).catch((e) => {
        // Show the link again when the change was not saved.
        setTaskId(previous);
        setError(e instanceof Error ? e.message : String(e));
      });
  }
  const modelName = models.find((m) => m.id === model)?.name || model;
  const mode = permissionModes[allowEdits ? 'edit' : 'read'];
  const linkTaskAvailable = !!trackerConnection(projectGroup) && !taskId;
  const showChanges = changesNotice && !active && changedFiles > 0 && !!repositoryId;
  return (
    <ConversationTools
      reviewRequest={reviewChanges}
      toolRequest={toolRequest}
      changeCount={repositoryId ? changedFiles : null}
      runsFinished={runsFinished}
      onChangesRead={() => readWorking.current()}
      onCommit={repositoryId ? () => setCommitOpen(true) : undefined}
      onToolChange={setToolOpen}
      visible={open && titlebarVisible}
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
        aria-label="Session"
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
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Loading session…
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
              <h3>{session.projectId ? 'What are we working on?' : 'Resume your session'}</h3>
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
            aria-label="Session messages"
          >
            {[
              ...messages,
              ...(run?.messages || []).map((message) => ({
                ...message,
                id: run!.id + ':' + message.id,
              })),
            ].map((message) => (
              <article className={'chat-message ' + message.role} key={message.id}>
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
              </article>
            ))}
          </div>
          {pastActivity.map((previous) => (
            <AgentActivity key={previous.id} api={api} run={previous} onUpdate={() => {}} />
          ))}
          {run && (
            <AgentActivity
              key={run.id}
              api={api}
              run={run}
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
              <ShieldAlert size={16} aria-hidden="true" />
              <span>The agent is waiting for your response</span>
              <Button size="sm" variant="outline" onClick={reviewApproval}>
                Review
              </Button>
            </div>
          )}
          {showChanges && (
            <div className="run-changes" role="status">
              <FileDiff className="size-3.5" aria-hidden="true" />
              <span>{plural(changedFiles, 'file')} changed</span>
              <span aria-hidden="true">·</span>
              <Button variant="chip" onClick={() => setReviewChanges((n) => n + 1)}>
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
                <span className="min-w-0 flex-1">This chat can read only. Allow edits?</span>
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
                You are on {working?.branch}, so this task chat starts with Can read only. Your
                checkout stays clean. Allow edits when you are ready.
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
                  Review the changes and verify the result before marking the linked tracker task
                  Done.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setReviewChanges((n) => n + 1)}
                  >
                    Review changes
                  </Button>
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
            {error && (
              <Alert variant="destructive" size="sm" className="max-h-32 overflow-auto">
                <AlertDescription className="text-xs whitespace-pre-wrap">
                  {error.replace(/^Error invoking remote method '[^']+': Error: /, '')}
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
                  {run?.errorCode === 'session_busy' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      disabled={!!active || !prompt.trim()}
                      onClick={() => void send()}
                    >
                      Retry session
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <Textarea
              ref={textarea}
              data-composer=""
              className="max-h-[clamp(80px,20vh,180px)] min-h-8 resize-none rounded-none border-0 bg-transparent px-2 py-1 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
              aria-label="Message agent"
              aria-description="Press Enter to send. Press Shift+Enter for a new line."
              placeholder="Ask anything…"
              value={prompt}
              maxLength={100000}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(event) => {
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
                  <span className="composer-task min-w-0" title={`Task · ${taskTitle}`}>
                    <Button
                      variant="chip"
                      className="min-w-0 bg-secondary text-secondary-foreground"
                      disabled={!!active || !trackerConnection(projectGroup)}
                      aria-label={`Task: ${taskTitle}. Change task`}
                      onClick={() => void openTaskLink()}
                    >
                      <span className="truncate">Task · {taskTitle}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-2xs"
                      className="rounded-full"
                      aria-label="Unlink task"
                      title="Unlink task"
                      disabled={!!active}
                      onClick={() => setUnlinkOpen(true)}
                    >
                      <X />
                    </Button>
                  </span>
                )}
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
        <Dialog open={linkOpen} onOpenChange={(value) => !linkBusy && setLinkOpen(value)}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Link a task</DialogTitle>
              <DialogDescription>
                Add task context to this session. General sessions can stay unlinked.
              </DialogDescription>
            </DialogHeader>
            <Choice
              className="w-full"
              label="Session task"
              value={linkChoice}
              onChange={setLinkChoice}
              disabled={linkBusy}
              options={[
                { value: '', label: 'No task' },
                ...linkItems.map((item) => ({ value: item.id, label: item.title })),
              ]}
            />
            {linkError && (
              <p role="alert" className="field-error">
                {linkError}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={linkBusy} onClick={() => setLinkOpen(false)}>
                Cancel
              </Button>
              <Button disabled={linkBusy || !!linkError} onClick={() => void saveTaskLink()}>
                Save task link
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
            onReview={() => setReviewChanges((n) => n + 1)}
            onCommitted={() => {
              readWorking.current();
              setRunsFinished((n) => n + 1);
            }}
            message={sessionTitle}
            pullRequestBody={
              taskId && linkedTask
                ? [`Task: ${linkedTask.title}`, linkedTask.url].filter(Boolean).join('\n')
                : `Changes from the Kalkidan session "${sessionTitle}".`
            }
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
        <ConfirmDialog
          open={unlinkOpen}
          title="Unlink task"
          description="The agent no longer gets this task as context. The task stays in the tracker. You can link it again later."
          confirmLabel="Unlink task"
          onCancel={() => setUnlinkOpen(false)}
          onConfirm={unlinkTask}
        />
      </section>
    </ConversationTools>
  );
}
