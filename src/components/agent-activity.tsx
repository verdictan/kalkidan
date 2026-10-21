import { Fragment, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, FileDiff, FileText, Gauge, Save, ShieldCheck } from 'lucide-react';
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
          request.actualCost !== null && [
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
                  onClick={() => openProjectPage(groupId, 'insights', taskId ? { taskId } : {})}
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
          aria-label={`Memory: ${summary}. Open the Memory page`}
          onClick={() => openProjectPage(groupId, 'memory')}
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
              onClick={() => openProjectPage(groupId, 'memory', { topic })}
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
                openProjectPage(groupId, 'docs', {
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

export function AgentActivity({
  api,
  run,
  onUpdate,
  groupId,
  taskId,
  docPassages = [],
  onReviewChanges,
}: {
  api: API;
  run: ChatRun;
  onUpdate: (run: ChatRun) => void;
  /** The project of the chat. Memory, docs and usage chips open its pages. */
  groupId?: string;
  /** The linked task. The usage chip opens its history. */
  taskId?: string;
  /** The doc passages that Kalkidan gave to the agent for "@docs". */
  docPassages?: DocPassage[];
  /** Opens the Changes tool on a file. */
  onReviewChanges?: (path?: string) => void;
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
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const paths = run.diff || run.tools?.some((tool) => tool.diff) ? changedPaths(run) : [];
  return (
    <div className="agent-activity space-y-3">
      {run.governance && <ManagedRun evidence={run.governance} groupId={groupId} taskId={taskId} />}
      <AgentQuestions api={api} run={run} onUpdate={onUpdate} />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {pending.map((approval) => (
        <section
          key={approval.id}
          aria-label="Agent approval"
          data-approval-pending=""
          tabIndex={-1}
          className={requestCardClass}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />
            <h3 className={requestTitleClass}>{approval.title}</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {agentLabel(run.agent)} is waiting.{' '}
            {approval.scope === 'turn'
              ? 'Permissions apply until this turn ends.'
              : 'Approval applies only to this request.'}
          </p>
          <div className="prose-ui" data-size="sm">
            <pre className={outputClass}>{approval.detail}</pre>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!!busy || run.status !== 'running'}
              onClick={() => void answer(approval.id, true)}
            >
              {approval.scope === 'turn' ? 'Allow for this turn' : 'Allow once'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || run.status !== 'running'}
              onClick={() => void answer(approval.id, false)}
            >
              Deny
            </Button>
          </div>
        </section>
      ))}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {(!!docPassages.length || !!run.tools?.length) && (
        <div className="grid gap-1.5">
          <DocsUse passages={docPassages} groupId={groupId} />
          <MemoryUse tools={run.tools || []} groupId={groupId} />
        </div>
      )}
      {!!run.tools?.length && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group gap-2 text-muted-foreground">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
              />
              Activity · {run.tools.length} {run.tools.length === 1 ? 'step' : 'steps'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {run.tools.map((tool) => {
              const memory = memoryKind(tool);
              return (
                <Collapsible key={tool.id} className="rounded-lg bg-muted">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-between gap-3 whitespace-normal rounded-lg p-3 text-left"
                    >
                      <span className="min-w-0 break-words">
                        {memory ? memoryTitles[memory] : tool.title}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {toolStatusLabels[tool.status] || words(tool.status)}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="prose-ui px-3 pb-3" data-size="sm">
                    <pre className={outputClass}>
                      {tool.diff || tool.detail || 'No additional output.'}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
      {(run.diff || paths.length > 0) && onReviewChanges && (
        <div className="flex flex-wrap items-center gap-2">
          <Hint label="Open the Changes tool on the files that this answer changed">
            <Button variant="outline" size="sm" onClick={() => onReviewChanges(paths[0])}>
              <FileDiff aria-hidden="true" />
              Review in Changes
            </Button>
          </Hint>
          {!!paths.length && (
            <span className="text-xs text-muted-foreground">{plural(paths.length, 'file')}</span>
          )}
        </div>
      )}
    </div>
  );
}
