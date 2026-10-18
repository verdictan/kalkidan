import { ConversationTools, type ConversationContext } from './conversation-tools';
import { AgentActivity } from './agent-activity';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { changeTaskStatus } from '../lib/task-status';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, LoaderCircle, Square, Terminal, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Choice } from './choice';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import type { API, ChatMessage, ChatRun, Session, ModelOption, ProjectGroup, GitHubItem } from '../types';

export function Conversation({ api, session, projectGroup, metadata, titlebarVisible = true, open, onComplete, onActivityChange, onSessionCreated }: { api: API; metadata?: ReactNode; titlebarVisible?: boolean; projectGroup?: ProjectGroup; session: Session; open: boolean; onComplete: () => void; onActivityChange: (active: boolean) => void; onSessionCreated?: (id: string, title: string) => void }) {
  const [toolOpen, setToolOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkItems, setLinkItems] = useState<GitHubItem[]>([]);
  const [linkChoice, setLinkChoice] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contexts, setContexts] = useState<ConversationContext[]>([]);
  const [prompt, setPrompt] = useState(session.initialPrompt || '');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [reviewTask, setReviewTask] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskNotice, setTaskNotice] = useState('');
  const taskUpdates = useRef(Promise.resolve());
  const startedTasks = useRef(new Set<string>());
  function syncStartedTask(next: ChatRun) {
    if (!taskId || startedTasks.current.has(next.id) || next.error || !next.sessionReady || !['running', 'completed'].includes(next.status)) return;
    startedTasks.current.add(next.id);
    taskUpdates.current = taskUpdates.current.then(async () => {
      try { await changeTaskStatus(api, projectGroup, taskId, 'progress'); setTaskNotice('Task moved to In progress.'); completed.current(); }
      catch (e) { setTaskNotice('Task status could not be updated: ' + (e instanceof Error ? e.message : String(e))); }
    });
  }
  async function markDone() {
    setTaskBusy(true);
    try { await taskUpdates.current; await changeTaskStatus(api, projectGroup, taskId, 'done'); setReviewTask(false); setTaskNotice('Task marked Done.'); completed.current(); }
    catch (e) { setTaskNotice(e instanceof Error ? e.message : String(e)); }
    finally { setTaskBusy(false); }
  }
  const [taskId, setTaskId] = useState(session.task?.id || session.organization?.taskId || '');
  useEffect(() => { let current = true; api.models?.(session.agent).then(value => { if (current) setModels(value); }).catch(() => {}); return () => { current = false; }; }, [api, session.agent]);
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
    if (taskId && next.status === 'completed' && !next.error) setReviewTask(true);
    if (session.projectId && !providerSession.current && next.sessionReady && next.sessionId) {
      providerSession.current = next.sessionId;
      if (taskId || session.organization) void api.updateSession(session.agent, next.sessionId, { ...session.organization, ...(taskId ? { taskId } : {}) }).then(() => completed.current()).catch(e => setError('Conversation saved, but its name, pin, or task link could not be saved: ' + e.message));
      onSessionCreated?.(next.sessionId, submitted.current?.text.trim().slice(0, 100) || session.title);
    }
    if (next.error) setError(next.error);
    if (next.errorCode === 'session_busy' && !next.messages.length && submitted.current?.runId === next.id) {
      const draft = submitted.current;
      setPrompt(draft.text);
      setMessages(previous => previous.filter(message => message.id !== draft.messageId));
      submitted.current = null;
    }
    completed.current();
  }
  const completed = useRef(onComplete);
  completed.current = onComplete;
  const active = starting || run?.status === 'running';
  useEffect(() => { onActivityChange(!!active); return () => onActivityChange(false); }, [active, onActivityChange]);
  const agentName = session.agent === 'codex' ? 'Codex' : 'Claude Code';
  useEffect(() => {
    mounted.current = true;
    let current = true;
    (session.projectId && !session.forkFrom ? Promise.resolve({ messages: [], truncated: false }) : api.transcript(session.agent, session.forkFrom || session.id)).then(value => { if (current) { setMessages(value.messages); setTruncated(value.truncated); } }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; mounted.current = false; };
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
        if (next.status !== 'running') { finishRun(next); return; }
      } catch (e) { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); }
      if (!cancelled) timer = setTimeout(poll, 400);
    }
    timer = setTimeout(poll, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, run?.id, run?.status]);
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, run, loading, open]);
  async function send() {
    if (!prompt.trim() || active || taskBusy || startingRef.current || loading) return;
    const text = [prompt, ...contexts.map(context => context.text)].join('\n\n');
    if (text.length > 100000) { setError('Message and context exceed 100,000 characters. Remove an attachment or shorten the message.'); return; }
    startingRef.current = true; setStarting(true); setError(''); setReviewTask(false); setTaskNotice('');
    try {
      const next = session.projectId && !providerSession.current
        ? await api.chatCreate(session.projectId, session.agent, text, allowEdits, { forkFrom: session.forkFrom, model: (model === 'custom' ? customModel.trim() : model) || undefined, taskId: taskId || undefined })
        : await api.chatStart(session.agent, providerSession.current || session.id, text, allowEdits, { model: (model === 'custom' ? customModel.trim() : model) || undefined, taskId: taskId || undefined });
      if (!mounted.current) { await api.chatStop(next.id); return; }
      if (runRef.current && (runRef.current.tools?.length || runRef.current.diff)) setPastActivity(previous => [...previous.slice(-19), runRef.current!]);
      const previousMessages = (runRef.current?.messages || []).map(message => ({ ...message, id: runRef.current!.id + ':' + message.id }));
      const messageId = crypto.randomUUID();
      submitted.current = { runId: next.id, messageId, text };
      setMessages(existing => [...existing, ...previousMessages, { id: messageId, role: 'user', text }]);
      syncStartedTask(next);
      setPrompt(''); setContexts([]); runRef.current = next; setRun(next); follow.current = true;
      if (next.error) setError(next.error);
      if (next.status !== 'running') finishRun(next);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { startingRef.current = false; setStarting(false); }
  }
  async function stop() {
    if (!run) return;
    try { await api.chatStop(run.id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function openTaskLink() {
    if (!projectGroup?.github) return;
    setLinkOpen(true); setLinkBusy(true); setLinkError(''); setLinkChoice(taskId);
    try { setLinkItems((await api.githubBoard(projectGroup.id)).items); }
    catch (e) { setLinkError(e instanceof Error ? e.message : String(e)); }
    finally { setLinkBusy(false); }
  }
  async function saveTaskLink() {
    setLinkBusy(true); setLinkError('');
    try {
      const id = providerSession.current || (!session.projectId ? session.id : null);
      if (id) await api.updateSession(session.agent, id, { taskId: linkChoice });
      setTaskId(linkChoice); setReviewTask(false); setTaskNotice(''); setLinkOpen(false); completed.current();
    } catch (e) { setLinkError(e instanceof Error ? e.message : String(e)); }
    finally { setLinkBusy(false); }
  }
  const empty = !loading && !messages.length && !run;
  return <ConversationTools onToolChange={setToolOpen} visible={open && titlebarVisible} remote={!!session.hostId} api={api} cwd={session.cwd} disabled={!!active || contexts.length >= 4} onAttach={context => setContexts(previous => [...previous, context])}>
    <section className={'conversation-panel' + (empty ? ' conversation-empty' : '')} aria-label="Conversation" data-tool-open={toolOpen}>
    <header className="conversation-header"><div className={'agent-mark ' + session.agent}>{session.agent === 'codex' ? <Terminal size={18}/> : '✳'}</div><div className="min-w-0"><h2>{session.organization?.title || session.title}</h2><p>{session.hostId ? 'SSH · ' : ''}{session.cwd.replace(/^\/Users\/[^/]+/, '~')}</p></div><span className="conversation-state">{run?.approvals?.some(a => a.status === 'pending') ? 'Needs approval' : active ? 'Responding' : run?.status === 'failed' ? 'Needs attention' : 'Ready'}</span></header>
    <div className="conversation-metadata">{metadata}</div>
    <div className="conversation-messages" ref={scroll} onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
      {loading && <div className="chat-loading"><LoaderCircle className="animate-spin" size={18}/> Loading conversation…</div>}
      {truncated && <p className="chat-context-note">Showing the most recent messages. {agentName} resumes the original session with its saved context.</p>}
      {!loading && !messages.length && <div className="conversation-welcome"><h3>{session.projectId ? 'What are we working on?' : 'Continue your conversation'}</h3><p>{session.projectId ? `Plan, build, and review with ${agentName}.` : 'Send a message to pick up where you left off.'}</p></div>}
      {[...messages, ...(run?.messages || []).map(message => ({ ...message, id: run!.id + ':' + message.id }))].map(message => <article className={'chat-message ' + message.role} key={message.id}><div className="chat-message-author">{message.role === 'user' ? 'You' : agentName}</div><div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[Image{alt ? `: ${alt}` : ''}]</span>, a: ({ children }) => <span className="chat-link">{children}</span> }}>{message.text}</Markdown></div></article>)}
      {pastActivity.map(previous => <AgentActivity key={previous.id} api={api} run={previous} onUpdate={() => {}}/>)}
      {run && <AgentActivity key={run.id} api={api} run={run} onUpdate={next => { runRef.current = next; setRun(next); if (next.status !== 'running') finishRun(next); }}/> }
      {active && <div role="status" className="chat-activity"><LoaderCircle size={14} className="animate-spin"/>{run?.activity && !run.activity.startsWith('message:') ? run.activity : `${agentName} is responding…`}</div>}
      {run?.status === 'stopped' && <p className="chat-context-note">Response stopped. Send another message to continue.</p>}
    </div>
    <div className="composer-dock">
    <Card className="conversation-composer">
      {!!contexts.length && <div className="context-attachments" aria-label="Attached context">{contexts.map(context => <div key={context.id}><span>{context.label}</span><Button variant="ghost" size="icon-sm" aria-label={`Remove ${context.label}`} disabled={!!active} onClick={() => setContexts(previous => previous.filter(item => item.id !== context.id))}><X size={12}/></Button></div>)}</div>}
      {taskId && taskNotice && <p role="status" className="text-xs text-muted-foreground">{taskNotice}</p>}
      {taskId && reviewTask && <div className="rounded-md border p-3 space-y-2" aria-label="Review task completion"><p className="text-sm font-medium">Is this task complete?</p><p className="text-xs text-muted-foreground">The agent finished responding. Review its work before updating GitHub.</p><div className="flex gap-2"><Button size="sm" disabled={taskBusy || !!active} onClick={() => void markDone()}>{taskBusy ? 'Updating…' : 'Mark task Done'}</Button><Button size="sm" variant="ghost" disabled={taskBusy} onClick={() => setReviewTask(false)}>Keep in progress</Button></div></div>}
      {error && <p className="chat-error" role="alert">{error.replace(/^Error invoking remote method '[^']+': Error: /, '')}{run?.errorCode === 'session_busy' && <Button variant="outline" size="sm" className="mt-2" disabled={!!active || !prompt.trim()} onClick={() => void send()}>Retry session</Button>}</p>}
      <Textarea disabled={!!active} aria-label="Message agent" placeholder={`Work with ${agentName}…`} value={prompt} maxLength={100000} onChange={e => setPrompt(e.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} rows={2}/>
      <div className="composer-actions">
        <Badge variant="secondary">{agentName}</Badge>{projectGroup?.github && !taskId && <Button variant="ghost" size="sm" disabled={!!active} onClick={() => void openTaskLink()}>Link task</Button>}
        <Choice label="Agent permissions" disabled={!!active} value={allowEdits ? 'edit' : 'read'} onChange={value => setAllowEdits(value === 'edit')} options={[{ value: 'read', label: 'Read only' }, { value: 'edit', label: 'Allow repository edits' }]}/>
        <div className="composer-model"><Choice label="Model" disabled={!!active} value={model} onChange={setModel} options={[{ value: '', label: 'Agent default' }, ...models.map(m => ({ value: m.id, label: m.name })), { value: 'custom', label: 'Custom model…' }]}/></div>
        <span className="composer-shortcut">⌘ Enter</span>{active ? <Button className="composer-send" aria-label="Stop" title="Stop response" variant="default" size="icon" disabled={starting} onClick={() => void stop()}><Square size={16}/></Button> : <Button className="composer-send" aria-label="Send" title="Send message (⌘ Enter)" size="icon" disabled={taskBusy || !prompt.trim() || loading || (model === 'custom' && !customModel.trim())} onClick={() => void send()}><ArrowUp size={19}/></Button>}
      </div>
      {model === 'custom' && <Input aria-label="Custom model ID" placeholder="Enter a model ID supported by your agent" value={customModel} disabled={!!active} onChange={e => setCustomModel(e.target.value)}/>}
      {taskId && <div className="flex items-center gap-2 text-xs"><Badge variant="outline">GitHub task · {linkItems.find(i => i.id === taskId)?.title || session.task?.title || 'Linked item'}</Badge><Button variant="ghost" size="xs" disabled={!!active} onClick={() => { setTaskId(''); const id = providerSession.current || (!session.projectId ? session.id : null); if (id) void api.updateSession(session.agent, id, { taskId: '' }).catch(e => setError(e.message)); }}>Clear context</Button></div>}

      </Card><p className="composer-note">{allowEdits ? 'The agent may edit repository files. Permission requests appear here for your approval.' : 'Ask questions and plan changes without enabling project edits.'}</p></div>
    <Dialog open={linkOpen} onOpenChange={value => !linkBusy && setLinkOpen(value)}><DialogContent><DialogHeader><DialogTitle>Link a task</DialogTitle><DialogDescription>Add GitHub task context to this conversation. General conversations can stay unlinked.</DialogDescription></DialogHeader><Choice className="w-full" label="Conversation task" value={linkChoice} onChange={setLinkChoice} disabled={linkBusy} options={[{ value: '', label: 'No task' }, ...linkItems.map(item => ({ value: item.id, label: item.title }))]}/>{linkError && <p role="alert" className="text-sm text-destructive">{linkError}</p>}<DialogFooter><Button variant="outline" disabled={linkBusy} onClick={() => setLinkOpen(false)}>Cancel</Button><Button disabled={linkBusy || !!linkError} onClick={() => void saveTaskLink()}>Save task link</Button></DialogFooter></DialogContent></Dialog>
  </section></ConversationTools>;
}
