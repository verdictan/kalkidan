import { Fragment, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  FilePen,
  FileText,
  Gauge,
  LoaderCircle,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import type { API, ChatRun, GovernanceEvidence, ToolActivity } from '../types';
import type { DocPassage } from '../domain/docs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { agentLabel } from '../config/agents';
import { errorMessage } from '../lib/errors';
import { diffFiles } from '../lib/diff-files';
import { plural } from '../lib/platform';
import { AgentQuestions, requestCardClass, requestTitleClass } from './agent-questions';
import { Hint } from './hint';
import { openProjectPage } from './chat-links';

// Approval details, tool output and diffs use the shared .prose-ui code block and one
// maximum height.
const outputClass = 'm-0 max-h-64 overflow-auto whitespace-pre-wrap break-words';

const toolStatusLabels: Record<string, string> = {
  inProgress: 'Running',
  completed: 'Complete',
  failed: 'Failed',
  declined: 'Declined',
};

/** Sentence case words for a value from the API, for example "policy_checked". */
function words(value: string) {
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type MemoryKind = 'search' | 'read' | 'remember' | 'sources';
/** The project memory tool of a step. Codex names it "memory_search", Claude Code
 * "mcp__kalkidan-memory__memory_search". */
function memoryKind(tool: ToolActivity): MemoryKind | null {
  const match = tool.title.match(/(?:^|__|\.|\/)memory_(search|read|remember|sources)$/);
  return match ? (match[1] as MemoryKind) : null;
}
const memoryTitles: Record<MemoryKind, string> = {
  search: 'Searched project memory',
  read: 'Read a memory entry',
  remember: 'Saved to project memory',
  sources: 'Listed the sources for memory',
};
/** The memory topic in the tool input or result, when the agent gave one. */
function memoryTopic(tool: ToolActivity) {
  const match = (tool.detail || '').match(/"topic"\s*:\s*"((?:[^"\\]|\\.){1,120})"/);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

/** The files that a run changed, from the step diffs and the run diff. */
function changedPaths(run: ChatRun) {
  const paths = new Set<string>();
  for (const tool of run.tools || []) {
    const first = tool.diff?.split('\n', 1)[0]?.trim();
    if (first && !first.startsWith('diff --git') && first.length < 400) paths.add(first);
  }
  if (run.diff?.includes('diff --git'))
    for (const file of diffFiles(run.diff)) if (file.path !== 'Changes') paths.add(file.path);
  return [...paths];
}

function governanceHeadline(evidence: GovernanceEvidence) {
  if (evidence.status === 'loading') return 'Checking the policy…';
  if (evidence.status === 'reconciling') return 'Updating the usage records…';
  if (evidence.status === 'unavailable') return 'Policy records are not available';
  return evidence.requests.some((request) => request.policy)
    ? 'Policy checked'
    : 'Waiting for policy records';
}

/** One line with Details. Values that are not known do not show. */
function ManagedRun({
  evidence,
  groupId,
  taskId,
}: {
  evidence: GovernanceEvidence;
  groupId?: string;
  taskId?: string;
}) {
  const requests = evidence.requests.slice(-5);
  const tokens = requests.reduce((sum, request) => {
    const value = Number(request.tokens);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const usageKnown = requests.some((request) => request.usage || request.tokens);
  const usageLabel = tokens ? `Usage · ${tokens.toLocaleString()} tokens` : 'Usage';
  const rows = requests
    .map(
      (request) =>
        [
          request.policy && ['Policy', words(request.policy)],
          request.usage && ['Usage', words(request.usage)],
          request.tokens && ['Tokens', Number(request.tokens).toLocaleString()],
          request.billing === 'subscription'
            ? ['Paid by', 'Your Claude subscription. The provider charge is not known.']
            : request.actualCost !== null && [
                'Recorded cost',
                `${request.actualCost} ${request.currency || ''}`.trim(),
              ],
          request.audit && ['Audit', words(request.audit)],
        ].filter(Boolean) as [string, string][],
    )
    .filter((row) => row.length);
  return (
    <section aria-label="Managed run" className="managed-run">
      <Collapsible>
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Managed run · {governanceHeadline(evidence)}</span>
          {usageKnown &&
            (groupId ? (
              <Hint label="Open the task usage history">
                <Button
                  variant="chip"
                  size="xs"
                  onClick={() =>
                    openProjectPage(groupId, 'knowledge', {
                      section: 'insights',
                      ...(taskId ? { taskId } : {}),
                    })
                  }
                >
                  <Gauge aria-hidden="true" />
                  {usageLabel}
                </Button>
              </Hint>
            ) : (
              <Badge variant="muted" size="sm">
                {usageLabel}
              </Badge>
            ))}
          {!!rows.length && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="group gap-1 text-muted-foreground">
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
                />
                Details
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
        <CollapsibleContent className="grid gap-2 pt-2 pl-5.5">
          {rows.map((row, index) => (
            <dl key={index} className="meta-list">
              {row.map(([label, value]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
            </dl>
          ))}
          <p className="form-help">
            Usage comes from the managed agent records. Provider charges are not included.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/** "Memory: read 2 · saved 1" and one chip for each topic. A chip opens the Memory page. */
function MemoryUse({ tools, groupId }: { tools: ToolActivity[]; groupId?: string }) {
  const used = tools
    .map((tool) => ({ tool, kind: memoryKind(tool) }))
    .filter(
      (entry): entry is { tool: ToolActivity; kind: MemoryKind } =>
        !!entry.kind && entry.kind !== 'sources' && entry.tool.status !== 'failed',
    );
  const read = used.filter((entry) => entry.kind !== 'remember');
  const saved = used.filter(
    (entry) => entry.kind === 'remember' && entry.tool.status === 'completed',
  );
  if (!read.length && !saved.length) return null;
  const topics = new Map<string, 'read' | 'saved'>();
  for (const entry of [...saved, ...read]) {
    const topic = memoryTopic(entry.tool);
    if (topic && !topics.has(topic))
      topics.set(topic, entry.kind === 'remember' ? 'saved' : 'read');
  }
  const summary = [read.length && `read ${read.length}`, saved.length && `saved ${saved.length}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="chat-sources" role="group" aria-label="Project memory used">
      {groupId ? (
        <Button
          variant="chip"
          size="xs"
          aria-label={`Memory: ${summary}. Open Memory`}
          onClick={() => openProjectPage(groupId, 'knowledge', { section: 'memory' })}
        >
          <BookOpen aria-hidden="true" />
          Memory: {summary}
        </Button>
      ) : (
        <span className="chat-sources-label">Memory: {summary}</span>
      )}
      {groupId &&
        [...topics].slice(0, 4).map(([topic, kind]) => (
          <Hint key={topic} label={`Open the memory topic “${topic}”`}>
            <Button
              variant="chip"
              size="xs"
              className="max-w-56"
              onClick={() => openProjectPage(groupId, 'knowledge', { section: 'memory', topic })}
            >
              {kind === 'saved' ? <Save aria-hidden="true" /> : <BookOpen aria-hidden="true" />}
              <span className="truncate">{topic}</span>
            </Button>
          </Hint>
        ))}
    </div>
  );
}

/** "Used 3 doc passages" and one chip for each passage. A chip opens the page at its heading. */
function DocsUse({ passages, groupId }: { passages: DocPassage[]; groupId?: string }) {
  if (!passages.length) return null;
  return (
    <div className="chat-sources" role="group" aria-label="Doc passages used">
      <span className="chat-sources-label">Used {plural(passages.length, 'doc passage')}</span>
      {passages.map((passage) => {
        const label = passage.heading ? `${passage.title} › ${passage.heading}` : passage.title;
        return groupId ? (
          <Hint key={passage.id + passage.heading} label={`Open ${label}`}>
            <Button
              variant="chip"
              size="xs"
              className="max-w-64"
              onClick={() =>
                openProjectPage(groupId, 'knowledge', {
                  section: 'pages',
                  docId: passage.id,
                  heading: passage.heading || undefined,
                })
              }
            >
              <FileText aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Button>
          </Hint>
        ) : (
          <Badge key={passage.id + passage.heading} variant="muted" size="sm">
            {label}
          </Badge>
        );
      })}
    </div>
  );
}

/** The added and removed line counts of a diff, for the right side of a step. */
function diffCounts(diff: string) {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

/** The added and removed lines of runs: the run diff, else the diffs of its steps. */
export function runLineCounts(runs: ChatRun[]) {
  let added = 0;
  let removed = 0;
  for (const run of runs)
    for (const diff of run.diff ? [run.diff] : (run.tools || []).map((tool) => tool.diff || '')) {
      const counts = diffCounts(diff);
      added += counts.added;
      removed += counts.removed;
    }
  return { added, removed };
}

/** The icon of a step: a file edit, a command, a read, a search, memory or another tool. */
function StepIcon({ tool }: { tool: ToolActivity }) {
  const props = { className: 'agent-step-icon', 'aria-hidden': true } as const;
  if (memoryKind(tool)) return <BookOpen {...props} />;
  if (tool.diff) return <FilePen {...props} />;
  const title = tool.title.trim();
  if (/^(read|view|open)\b/i.test(title)) return <FileText {...props} />;
  if (/^(search|grep|glob|find|rg)\b|search/i.test(title)) return <Search {...props} />;
  if (
    /^(\$|npm|npx|pnpm|yarn|git|node|python3?|bash|sh|zsh|make|cargo|go|ls|cat|cd|rm|mv|cp|mkdir)\b|^(bash|shell|command)/i.test(
      title,
    )
  )
    return <SquareTerminal {...props} />;
  return <Wrench {...props} />;
}

/** One 24px line for a step: icon, title and the result on the right. A click shows its output. */
function StepLine({ tool }: { tool: ToolActivity }) {
  const memory = memoryKind(tool);
  const live = tool.status === 'inProgress';
  const failed = tool.status === 'failed' || tool.status === 'declined';
  const counts = tool.diff ? diffCounts(tool.diff) : null;
  const output = tool.diff || tool.detail;
  const line = (
    <>
      {live ? (
        <LoaderCircle className="agent-step-icon animate-spin" aria-hidden="true" />
      ) : (
        <StepIcon tool={tool} />
      )}
      <span className="agent-step-title">{memory ? memoryTitles[memory] : tool.title}</span>
      <span className="agent-step-result">
        {failed ? (
          toolStatusLabels[tool.status]
        ) : live ? (
          <span className="sr-only">{toolStatusLabels.inProgress}</span>
        ) : counts && (counts.added || counts.removed) ? (
          <>
            {!!counts.added && <span className="diff-count-add">+{counts.added}</span>}
            {!!counts.removed && <span className="diff-count-remove"> −{counts.removed}</span>}
          </>
        ) : null}
      </span>
    </>
  );
  if (!output)
    return (
      <div className="agent-step" data-failed={failed || undefined}>
        {line}
      </div>
    );
  return (
    <Collapsible>
      <CollapsibleTrigger className="agent-step" data-failed={failed || undefined}>
        {line}
      </CollapsibleTrigger>
      <CollapsibleContent className="prose-ui agent-step-output" data-size="sm">
        <pre className={outputClass}>{output}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The activity of one run, under the answer it belongs to: the managed run line, the docs and
 * memory that the agent used, and the steps folded to "N steps · M files edited". The live step
 * always shows.
 */
export function AgentActivity({
  run,
  groupId,
  taskId,
  docPassages = [],
}: {
  run: ChatRun;
  /** The project of the chat. Memory, docs and usage chips open its pages. */
  groupId?: string;
  /** The linked task. The usage chip opens its history. */
  taskId?: string;
  /** The doc passages that Kalkidan gave to the agent for "@docs". */
  docPassages?: DocPassage[];
}) {
  const tools = run.tools || [];
  const paths = run.diff || tools.some((tool) => tool.diff) ? changedPaths(run) : [];
  const live = run.status === 'running' ? tools.filter((tool) => tool.status === 'inProgress') : [];
  const summary = [
    plural(tools.length, 'step'),
    paths.length && `${plural(paths.length, 'file')} edited`,
  ]
    .filter(Boolean)
    .join(' · ');
  if (!run.governance && !docPassages.length && !tools.length) return null;
  return (
    <div className="agent-activity">
      {run.governance && <ManagedRun evidence={run.governance} groupId={groupId} taskId={taskId} />}
      {(!!docPassages.length || !!tools.length) && (
        <>
          <DocsUse passages={docPassages} groupId={groupId} />
          <MemoryUse tools={tools} groupId={groupId} />
        </>
      )}
      {!!tools.length && (
        <Collapsible className="agent-steps">
          <CollapsibleTrigger className="agent-steps-fold group">
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
            />
            {summary}
          </CollapsibleTrigger>
          <CollapsibleContent className="agent-step-list">
            {tools.map((tool) => (
              <StepLine key={tool.id} tool={tool} />
            ))}
          </CollapsibleContent>
          {/* The live step shows also while the steps are folded. */}
          <div className="agent-step-list agent-step-live" aria-live="polite">
            {live.map((tool) => (
              <StepLine key={tool.id} tool={tool} />
            ))}
          </div>
        </Collapsible>
      )}
    </div>
  );
}

/**
 * The approval and question cards of a run. They dock above the composer, so they never scroll
 * away. "Tell {agent} what to do instead" denies the request and puts the cursor in the
 * composer.
 */
export function RunRequests({
  api,
  run,
  onUpdate,
  onInstead,
}: {
  api: API;
  run: ChatRun;
  onUpdate: (run: ChatRun) => void;
  /** Moves the cursor to the composer after "Tell {agent} what to do instead". */
  onInstead: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Announce each new approval request. The live region is always on screen, so
  // screen readers detect the change of text.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());
  const pending = (run.approvals || []).filter((a) => a.status === 'pending');
  const pendingKey = pending.map((a) => a.id).join('|');
  useEffect(() => {
    const fresh = pending.filter((a) => !announced.current.has(a.id));
    if (!fresh.length) return;
    for (const approval of fresh) announced.current.add(approval.id);
    setAnnouncement(`Approval needed: ${fresh.at(-1)!.title}`);
  }, [pendingKey]);
  async function answer(id: string, allow: boolean) {
    setBusy(id);
    setError('');
    try {
      await api.chatApprove(run.id, id, allow);
      onUpdate(await api.chatStatus(run.id));
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const agent = agentLabel(run.agent);
  const running = run.status === 'running';
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {running && <AgentQuestions api={api} run={run} onUpdate={onUpdate} pendingOnly />}
      {running &&
        pending.map((approval) => (
          <section
            key={approval.id}
            aria-label="Agent approval"
            className={requestCardClass + ' request-card-approval'}
          >
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="shrink-0 text-warning" aria-hidden="true" />
              <h3 className={requestTitleClass}>{approval.title}</h3>
            </div>
            <div className="prose-ui" data-size="sm">
              <pre className={outputClass + ' max-h-40'}>{approval.detail}</pre>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="mr-auto"
                disabled={!!busy}
                onClick={() =>
                  void answer(approval.id, false).then((done) => {
                    if (done) onInstead();
                  })
                }
              >
                Tell {agent} what to do instead
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => void answer(approval.id, false)}
              >
                Deny
              </Button>
              <Button
                size="sm"
                autoFocus
                disabled={!!busy}
                onClick={() => void answer(approval.id, true)}
              >
                {approval.scope === 'turn' ? 'Allow for this turn' : 'Allow once'}
              </Button>
            </div>
          </section>
        ))}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </>
  );
}
