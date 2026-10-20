import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { API, ChatRun } from '../types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Button } from './ui/button';
import { agentLabel } from '../config/agents';
import { errorMessage } from '../lib/errors';

// Approval details, tool output and diffs use the shared .prose-ui code block and one
// maximum height.
const outputClass = 'm-0 max-h-64 overflow-auto whitespace-pre-wrap break-words';

export function AgentActivity({
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
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="agent-activity space-y-3">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {pending.map((approval) => (
        <section
          key={approval.id}
          aria-label="Agent approval"
          data-approval-pending=""
          tabIndex={-1}
          className="space-y-3 rounded-lg bg-muted p-3 focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} aria-hidden="true" />
            <h3 className="font-semibold">{approval.title}</h3>
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
            {run.tools.map((tool) => (
              <Collapsible key={tool.id} className="rounded-lg bg-muted">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between gap-3 whitespace-normal rounded-lg p-3 text-left"
                  >
                    <span className="min-w-0 break-words">{tool.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {tool.status === 'inProgress'
                        ? 'Running'
                        : tool.status === 'completed'
                          ? 'Complete'
                          : tool.status === 'failed'
                            ? 'Failed'
                            : tool.status === 'declined'
                              ? 'Declined'
                              : tool.status}
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="prose-ui px-3 pb-3" data-size="sm">
                  <pre className={outputClass}>
                    {tool.diff || tool.detail || 'No additional output.'}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
      {run.diff && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              View changes
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="prose-ui pt-3" data-size="sm">
            <pre className={outputClass}>{run.diff}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
