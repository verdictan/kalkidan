import { Fragment, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  FilePen,
  FileText,
  Lightbulb,
  LoaderCircle,
  Save,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import type { API, ChatRun, GovernanceEvidence, ToolActivity } from '../types';
import type { DocPassage } from '../domain/docs';
import type { ContextUsage } from '../domain/memory';
import { eventBufferWarning } from '../domain/conversation';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { errorMessage } from '../lib/errors';
import { diffFiles } from '../lib/diff-files';
import { plural } from '../lib/platform';
import { AgentQuestions } from './agent-questions';
import { ChatCard } from './chat-card';
import { DiffBlock, isPatch } from './diff-review';
import { Hint } from './hint';
import { openProjectPage } from './chat-links';
import { openProjectUsage } from './project-usage';

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

/** The policy and usage rows of a managed run, behind the summary line. */
function ManagedRunDetails({
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
  const last = requests.at(-1);
  const rows: [string, string][] = [
    ['Policy', last?.policy ? words(last.policy) : governanceHeadline(evidence)],
  ];
  if (last?.billing === 'subscription') rows.push(['Paid by', 'Your Claude subscription']);
  else if (last && last.actualCost !== null && last.actualCost !== undefined)
    rows.push(['Cost', `${last.actualCost} ${last.currency || ''}`.trim()]);
  if (tokens) rows.push(['Tokens', tokens.toLocaleString()]);
  if (last?.audit) rows.push(['Audit', words(last.audit)]);
  return (
    <section aria-label="Managed run" className="agent-detail">
      <dl className="meta-list">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
        {usageKnown && groupId && (
          <>
            <dt>Usage</dt>
            <dd>
              <Button variant="link" onClick={() => openProjectUsage(groupId, taskId)}>
                Show usage
              </Button>
            </dd>
          </>
        )}
      </dl>
      {evidence.bufferWarning && (
        <p role="status" className="form-help text-warning">
          {eventBufferWarning(evidence.bufferWarning)}
        </p>
      )}
    </section>
  );
}

/** The memory topics that a run read or saved. A chip opens the topic in Knowledge. */
function MemoryUse({ tools, groupId }: { tools: ToolActivity[]; groupId?: string }) {
  const used = tools
    .map((tool) => ({ tool, kind: memoryKind(tool) }))
    .filter(
      (entry): entry is { tool: ToolActivity; kind: MemoryKind } =>
        !!entry.kind && entry.kind !== 'sources' && entry.tool.status !== 'failed',
    );
  const topics = new Map<string, 'read' | 'saved'>();
  for (const entry of used) {
    if (entry.kind === 'remember' && entry.tool.status !== 'completed') continue;
    const topic = memoryTopic(entry.tool);
    if (topic && topics.get(topic) !== 'saved')
      topics.set(topic, entry.kind === 'remember' ? 'saved' : 'read');
  }
  if (!topics.size) return null;
  return (
    <div className="chat-sources" role="group" aria-label="Project memory used">
      {[...topics].slice(0, 6).map(([topic, kind]) =>
        groupId ? (
          <Hint key={topic} label={kind === 'saved' ? 'Saved to memory' : 'Read from memory'}>
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
        ) : (
          <Badge key={topic} variant="muted" size="sm">
            {topic}
          </Badge>
        ),
      )}
    </div>
  );
}

/** The doc passages that "@docs" gave to the agent. A chip opens the page at its heading. */
function DocsUse({ passages, groupId }: { passages: DocPassage[]; groupId?: string }) {
  if (!passages.length) return null;
  return (
    <div className="chat-sources" role="group" aria-label="Doc passages used">
      {passages.map((passage) => {
        const label = passage.heading ? `${passage.title} › ${passage.heading}` : passage.title;
        return groupId ? (
          <Button
            key={passage.id + passage.heading}
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
        ) : (
          <Badge key={passage.id + passage.heading} variant="muted" size="sm">
            {label}
          </Badge>
        );
      })}
    </div>
  );
}

/** The facts and pages that the chat read. An item opens it in Knowledge. */
function ContextUse({ usage, groupId }: { usage: ContextUsage; groupId?: string }) {
  if (!usage.memory.length && !usage.docs.length) return null;
  const open = (detail: Record<string, string>) =>
    groupId &&
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-project-page', {
        detail: { groupId, page: 'knowledge', ...detail },
      }),
    );
  return (
    <div className="chat-sources" role="group" aria-label="Context the agent read">
      {usage.memory.map((fact) => (
        <Button
          key={fact.id}
          variant="chip"
          size="xs"
          className="max-w-56"
          onClick={() => open({ section: 'memory', topic: fact.topic, factId: fact.id })}
        >
          <Lightbulb aria-hidden="true" />
          <span className="truncate">{fact.title || fact.topic}</span>
        </Button>
      ))}
      {usage.docs.map((doc) => (
        <Button
          key={doc.docId + (doc.heading || '')}
          variant="chip"
          size="xs"
          className="max-w-64"
          onClick={() =>
            open({
              section: 'pages',
              docId: doc.docId,
              ...(doc.heading ? { heading: doc.heading } : {}),
            })
          }
        >
          <FileText aria-hidden="true" />
          <span className="truncate">
            {doc.title || 'Untitled'}
            {doc.heading ? ` › ${doc.heading}` : ''}
          </span>
        </Button>
      ))}
    </div>
  );
}

/** "2 facts · 1 page", or an empty text when the agent read nothing. */
export function contextUsageText(usage: ContextUsage | undefined) {
  if (!usage) return '';
  return [
    usage.memory.length ? plural(usage.memory.length, 'fact') : '',
    usage.docs.length ? plural(usage.docs.length, 'page') : '',
  ]
    .filter(Boolean)
    .join(' · ');
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
        {tool.diff ? (
          <DiffBlock patch={tool.diff} label={`Changes: ${tool.title}`} />
        ) : (
          <pre className={outputClass}>{output}</pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The activity of one run, under the answer it belongs to: one quiet line,
 * "23 steps · 3 files edited". The steps, the policy and usage, and the memory, docs and
 * context that the agent used are behind it. The live step always shows. Without a run, the
 * line shows only the context that the chat read.
 */
export function AgentActivity({
  run,
  groupId,
  taskId,
  docPassages = [],
  context,
}: {
  run?: ChatRun;
  /** The project of the chat. Memory, docs and usage open its pages. */
  groupId?: string;
  /** The linked task. Usage opens its history. */
  taskId?: string;
  /** The doc passages that Kalkidan gave to the agent for "@docs". */
  docPassages?: DocPassage[];
  /** The facts and pages that the chat read. The last run of the chat shows them. */
  context?: ContextUsage;
}) {
  const tools = run?.tools || [];
  const paths = run && (run.diff || tools.some((tool) => tool.diff)) ? changedPaths(run) : [];
  const live =
    run?.status === 'running' ? tools.filter((tool) => tool.status === 'inProgress') : [];
  const contextText = contextUsageText(context);
  const summary = tools.length
    ? [plural(tools.length, 'step'), paths.length && `${plural(paths.length, 'file')} edited`]
        .filter(Boolean)
        .join(' · ')
    : contextText
      ? `Read ${contextText}`
      : run?.governance
        ? governanceHeadline(run.governance)
        : docPassages.length
          ? `Read ${plural(docPassages.length, 'doc passage')}`
          : '';
  if (!summary) return null;
  return (
    <Collapsible className="agent-activity agent-steps">
      <CollapsibleTrigger className="agent-steps-fold group">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
        />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent className="agent-activity-detail">
        {!!tools.length && (
          <div className="agent-step-list">
            {tools.map((tool) => (
              <StepLine key={tool.id} tool={tool} />
            ))}
          </div>
        )}
        <DocsUse passages={docPassages} groupId={groupId} />
        <MemoryUse tools={tools} groupId={groupId} />
        {context && <ContextUse usage={context} groupId={groupId} />}
        {run?.governance && (
          <ManagedRunDetails evidence={run.governance} groupId={groupId} taskId={taskId} />
        )}
      </CollapsibleContent>
      {/* The live step shows also while the line is folded. */}
      {!!live.length && (
        <div className="agent-step-list agent-step-live" aria-live="polite">
          {live.map((tool) => (
            <StepLine key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </Collapsible>
  );
}

/**
 * The approval and question cards of a run. They dock above the composer, so they never scroll
 * away. An approval has two buttons: Deny and Allow. To tell the agent what to do instead, the
 * user types in the composer.
 */
export function RunRequests({
  api,
  run,
  onUpdate,
}: {
  api: API;
  run: ChatRun;
  onUpdate: (run: ChatRun) => void;
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
  const running = run.status === 'running';
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {running && <AgentQuestions api={api} run={run} onUpdate={onUpdate} pendingOnly />}
      {running &&
        pending.map((approval) => (
          <ChatCard
            key={approval.id}
            label="Agent approval"
            tone="warning"
            icon={ShieldAlert}
            title={approval.title}
            actions={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void answer(approval.id, false)}
                >
                  Deny
                </Button>
                <Hint label={approval.scope === 'turn' ? 'For this turn' : 'Once'}>
                  <Button
                    size="sm"
                    disabled={!!busy}
                    onClick={() => void answer(approval.id, true)}
                  >
                    Allow
                  </Button>
                </Hint>
              </>
            }
          >
            {approval.detail &&
              (isPatch(approval.detail) ? (
                <DiffBlock patch={approval.detail} className="max-h-40" />
              ) : (
                <pre className="chat-card-command">{approval.detail}</pre>
              ))}
          </ChatCard>
        ))}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </>
  );
}
