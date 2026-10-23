import type { SubagentSession } from '../domain/desktop';
import { useIdentityColor } from '../hooks/use-identity';
import { IdentityMark } from './ui/identity-mark';
import { StatusGlyph } from './ui/status-glyph';

const statusText: Record<SubagentSession['status'], string> = {
  running: 'working',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
};

/** The DOM ID of the card of a subagent. The tree opens the chat at this card. */
export function subagentCardId(id: string) {
  return 'subagent-' + id.replace(/[^\w-]/g, '_');
}

/**
 * One subagent in the chat (SH-A3): its diamond mark in its own color, its name, and
 * "Subagent · what it does now". A working subagent has a spinner, a failed one a red cross.
 */
export function SubagentCard({ subagent }: { subagent: SubagentSession }) {
  const color = useIdentityColor('subagent', subagent.id, subagent.title);
  const running = subagent.status === 'running';
  const detail = (running && subagent.activity) || statusText[subagent.status];
  return (
    <section
      id={subagentCardId(subagent.id)}
      className="subagent-card"
      data-status={subagent.status}
      aria-label={`Subagent ${subagent.title}`}
      tabIndex={-1}
    >
      <IdentityMark kind="subagent" color={color} />
      <span className="subagent-card-text">
        <span className="subagent-card-title">{subagent.title}</span>
        <span className="subagent-card-detail">
          Subagent{subagent.type ? ` · ${subagent.type}` : ''} · {detail}
        </span>
      </span>
      <StatusGlyph status={running ? 'working' : subagent.status === 'failed' ? 'failed' : null} />
    </section>
  );
}

/**
 * The subagents of one run, oldest first. Only the subagents that work or failed show, so a
 * finished chat stays short (CH-B5). A finished subagent shows when the tree opens the chat at
 * it (`shown`).
 */
export function SubagentCards({
  subagents,
  shown,
}: {
  subagents?: SubagentSession[];
  shown?: string;
}) {
  const visible = (subagents || []).filter(
    (subagent) =>
      subagent.status === 'running' || subagent.status === 'failed' || subagent.id === shown,
  );
  if (!visible.length) return null;
  return (
    <div className="subagent-cards">
      {visible.map((subagent) => (
        <SubagentCard key={subagent.id} subagent={subagent} />
      ))}
    </div>
  );
}
