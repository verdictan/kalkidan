import { interfaceConfig } from '../config/interface';
import { trackerConnection } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import { ConversationTools, type ConversationContext } from './conversation-tools';
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
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, ShieldAlert, Square, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Choice } from './choice';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
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
  titlebarVisible = true,
  open,
  onComplete,
  onActivityChange,
  onSessionCreated,
}: {
  api: API;
  titlebarVisible?: boolean;
  projectGroup?: ProjectGroup;
  session: Session;
  open: boolean;
  onComplete: () => void;
  onActivityChange: (activity: SessionActivityState | null) => void;
  onSessionCreated?: (id: string, title: string) => void;
}) {
  const [toolOpen, setToolOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<TrackerItem[]>([]);
  const [linkChoice, setLinkChoice] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contexts, setContexts] = useState<ConversationContext[]>([]);
  const [prompt, setPrompt] = useState(session.initialPrompt || '');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [reviewTask, setReviewTask] = useState(false);
  const [reviewChanges, setReviewChanges] = useState(0);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskNotice, setTaskNotice] = useState('');
  const taskUpdates = useRef(Promise.resolve());
  const startedTasks = useRef(new Set<string>());
  function syncStartedTask(next: ChatRun) {
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
  async function markDone() {
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
  const [allowEdits, setAllowEdits] = useState(false);
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
  const runRef = useRef<ChatRun | null>(null);
  const providerSession = useRef<string | null>(null);
  const submitted = useRef<{ runId: string; messageId: string; text: string } | null>(null);
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
        submitted.current?.text.trim().slice(0, 100) || session.title,
      );
    }
    if (next.error) setError(next.error);
    if (
      next.errorCode === 'session_busy' &&
      !next.messages.length &&
      submitted.current?.runId === next.id
    ) {
      const draft = submitted.current;
      setPrompt(draft.text);
      setMessages((previous) => previous.filter((message) => message.id !== draft.messageId));
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
    if (!run || run.status !== 'running') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.chatStatus(run!.id);
        if (cancelled) return;
        runRef.current = next;
        syncStartedTask(next);
        setRun(next);
        if (next.status !== 'running') {
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
  }, [api, run?.id, run?.status]);
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, run, loading, open]);
  const pendingApprovals = (run?.approvals || []).filter((a) => a.status === 'pending').length;
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
  async function send() {
    if (!prompt.trim() || active || taskBusy || startingRef.current || loading) return;
    const text = [prompt, ...contexts.map((context) => context.text)].join('\n\n');
    if (text.length > 100000) {
      setError(
        'Message and context exceed 100,000 characters. Remove an attachment or shorten the message.',
      );
      return;
    }
    startingRef.current = true;
    setStarting(true);
    setError('');
    setReviewTask(false);
    setTaskNotice('');
    try {
      const next =
        session.projectId && !providerSession.current
          ? await api.chatCreate(session.projectId, session.agent, text, allowEdits, {
              forkFrom: session.forkFrom,
              model: model || undefined,
              taskId: taskId || undefined,
            })
          : await api.chatStart(
              session.agent,
              providerSession.current || session.id,
              text,
              allowEdits,
              {
                model: model || undefined,
                taskId: taskId || undefined,
              },
            );
      if (!mounted.current) {
        await api.chatStop(next.id);
        return;
      }
      if (runRef.current && (runRef.current.tools?.length || runRef.current.diff))
        setPastActivity((previous) => [...previous.slice(-19), runRef.current!]);
      const previousMessages = (runRef.current?.messages || []).map((message) => ({
        ...message,
        id: runRef.current!.id + ':' + message.id,
      }));
      const messageId = crypto.randomUUID();
      submitted.current = { runId: next.id, messageId, text };
      setMessages((existing) => [
        ...existing,
        ...previousMessages,
        { id: messageId, role: 'user', text },
      ]);
      syncStartedTask(next);
      setPrompt('');
      setContexts([]);
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
  const empty = !loading && !messages.length && !run;
  const nextActivity =
    run?.activity && !run.activity.startsWith('message:')
      ? run.activity
      : `${agentName} is responding…`;
  // The status poll runs every 400 ms. Keep the announced text until it really changes.
  const [activityText, setActivityText] = useState(nextActivity);
  if (active && activityText !== nextActivity) setActivityText(nextActivity);
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
  return (
    <ConversationTools
      reviewRequest={reviewChanges}
      onToolChange={setToolOpen}
      visible={open && titlebarVisible}
      remote={!!session.hostId}
      api={api}
      cwd={session.cwd}
      disabled={!!active || contexts.length >= interfaceConfig.maxAttachments}
      onAttach={(context) => setContexts((previous) => [...previous, context])}
    >
      <section
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
              <LoaderCircle className="animate-spin" size={18} /> Loading session…
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
                <div className="chat-markdown">
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
                runRef.current = next;
                setRun(next);
                if (next.status !== 'running') finishRun(next);
              }}
            />
          )}
          {active && (
            <div className="chat-activity">
              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
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
              <ShieldAlert size={15} aria-hidden="true" />
              <span>The agent is waiting for your approval</span>
              <Button size="xs" variant="outline" onClick={reviewApproval}>
                Review
              </Button>
            </div>
          )}
          <Card className="conversation-composer">
            {!!contexts.length && (
              <div className="context-attachments" aria-label="Attached context">
                {contexts.map((context) => (
                  <div key={context.id}>
                    <span>{context.label}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${context.label}`}
                      disabled={!!active}
                      onClick={() =>
                        setContexts((previous) => previous.filter((item) => item.id !== context.id))
                      }
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {taskId && taskNotice && (
              <p role="status" className="text-xs text-muted-foreground">
                {taskNotice}
              </p>
            )}
            {taskId && !reviewTask && (
              <Button
                variant="ghost"
                size="sm"
                className="mb-2"
                disabled={!!active || taskBusy}
                onClick={() => setReviewTask(true)}
              >
                Review task completion
              </Button>
            )}
            {taskId && reviewTask && (
              <div
                className="rounded-md border p-3 space-y-2"
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
                  <Button size="sm" disabled={taskBusy || !!active} onClick={() => void markDone()}>
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
              <p className="chat-error" role="alert">
                {error.replace(/^Error invoking remote method '[^']+': Error: /, '')}
                {run?.errorCode === 'session_busy' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={!!active || !prompt.trim()}
                    onClick={() => void send()}
                  >
                    Retry session
                  </Button>
                )}
              </p>
            )}
            <Textarea
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
                <div className="composer-model">
                  <Choice
                    label="Model"
                    disabled={!!active}
                    value={model}
                    onChange={setModel}
                    options={[
                      { value: '', label: `${agentName} · Default` },
                      ...models.map((m) => ({ value: m.id, label: m.name })),
                    ]}
                  />
                </div>
                <Choice
                  label="Agent permissions"
                  disabled={!!active}
                  value={allowEdits ? 'edit' : 'read'}
                  onChange={(value) => setAllowEdits(value === 'edit')}
                  options={[
                    { value: 'read', label: 'Read only' },
                    { value: 'edit', label: 'Allow edits' },
                  ]}
                />
                {trackerConnection(projectGroup) && !taskId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!active}
                    onClick={() => void openTaskLink()}
                  >
                    Link task
                  </Button>
                )}
              </div>
              <span className="composer-shortcut" aria-hidden="true">
                Enter to send · Shift+Enter for new line
              </span>
              {active ? (
                <Button
                  className="composer-send"
                  aria-label="Stop"
                  title="Stop response"
                  variant="default"
                  size="icon"
                  disabled={starting}
                  onClick={() => void stop()}
                >
                  <Square size={16} />
                </Button>
              ) : (
                <Button
                  className="composer-send"
                  aria-label="Send"
                  aria-keyshortcuts="Enter"
                  size="icon"
                  disabled={taskBusy || !prompt.trim() || loading}
                  onClick={() => void send()}
                >
                  <ArrowUp size={19} />
                </Button>
              )}
            </div>
            {modelsFailed && (
              <p role="status" className="text-xs text-muted-foreground">
                Could not load models. Default model is used.
              </p>
            )}
            {taskId && (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">
                  Task ·{' '}
                  {linkItems.find((i) => i.id === taskId)?.title ||
                    session.task?.title ||
                    'Linked task'}
                </Badge>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!!active}
                  onClick={() => setUnlinkOpen(true)}
                >
                  Unlink task
                </Button>
              </div>
            )}
          </Card>
        </div>
        <Dialog open={linkOpen} onOpenChange={(value) => !linkBusy && setLinkOpen(value)}>
          <DialogContent>
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
              <p role="alert" className="text-sm text-destructive">
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
