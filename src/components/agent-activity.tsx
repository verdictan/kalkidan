import { useState } from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { API, ChatRun } from '../types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Button } from './ui/button';

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
  async function answer(id: string, allow: boolean) {
    setBusy(id);
    setError('');
    try {
      await api.chatApprove(run.id, id, allow);
      onUpdate(await api.chatStatus(run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="agent-activity space-y-3">
      {(run.approvals || [])
        .filter((a) => a.status === 'pending')
        .map((approval) => (
          <section
            key={approval.id}
            aria-label="Agent approval"
            className="space-y-3 rounded-xl border bg-card p-4"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} />
              <h3 className="font-medium">{approval.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {run.agent === 'codex' ? 'Codex' : 'Claude Code'} is waiting.{' '}
              {approval.scope === 'turn'
                ? 'Permissions apply until this turn ends.'
                : 'Approval applies only to this request.'}
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
              {approval.detail}
            </pre>
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!!run.tools?.length && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <ChevronRight size={14} />
              Activity · {run.tools.length} {run.tools.length === 1 ? 'step' : 'steps'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {run.tools.map((tool) => (
              <Collapsible key={tool.id} className="rounded-lg border">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between gap-3 whitespace-normal p-3 text-left"
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
                <CollapsibleContent className="px-3 pb-3">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
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
          <CollapsibleContent className="pt-3">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 font-mono text-xs">
              {run.diff}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
