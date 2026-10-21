import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { API, Session } from '../types';
import {
  projectUsageLimits,
  summarizeProjectUsage,
  usageCostText,
  type ProjectUsage,
  type UsageTokens,
} from '../domain/project-usage';
import { agentLabel } from '../config/agents';
import { usageValuesNote } from '../domain/managed-history';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { fullTime, relativeTime } from '../lib/relative-time';
import { openChat } from './planning-kit';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { SectionHeader } from './ui/page-header';
import { Hint } from './hint';

const count = (value: number) => value.toLocaleString('en-US');
function tokenText(tokens: UsageTokens) {
  return `${count(tokens.input)} in · ${count(tokens.output)} out · ${count(tokens.cached)} cached`;
}
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * The managed-agent usage of a project: requests, policy decisions, tokens, models, chats and
 * requests for each day. The data comes from the Verdictan history of each chat. Kalkidan does
 * not calculate a price. A subscription has no provider charge to show.
 */
export function ProjectUsageInsights({
  api,
  groupId,
  sessions,
}: {
  api: API;
  groupId: string;
  /** The chats of the project. Only chats on this computer have a managed history. */
  sessions: Session[];
}) {
  const chats = useMemo(
    () =>
      sessions
        .filter((session) => !session.hostId && !session.id.startsWith('draft-'))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions],
  );
  const key = chats.map((chat) => `${chat.agent}:${chat.id}`).join(',');
  const [usage, setUsage] = useState<ProjectUsage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = typeof api.projectUsage === 'function';
  const current = useRef('');
  current.current = groupId + '|' + key;
  async function load() {
    if (!available || !chats.length) return;
    const requested = current.current;
    setBusy(true);
    setError('');
    try {
      const next = await api.projectUsage(
        groupId,
        chats.map((chat) => ({ agent: chat.agent, sessionId: chat.id })),
      );
      if (current.current === requested) setUsage(next);
    } catch (failure) {
      if (current.current === requested) setError(errorMessage(failure));
    } finally {
      if (current.current === requested) setBusy(false);
    }
  }
  useEffect(() => {
    setUsage(undefined);
    setError('');
    void load();
    // A new project or a new chat loads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, key, available]);
  const summary = useMemo(
    () => (usage ? summarizeProjectUsage(usage, Date.parse(usage.observedAt) || Date.now()) : null),
    [usage],
  );
  const title = (agent: string, id: string) => {
    const chat = chats.find((value) => value.agent === agent && value.id === id);
    return chat ? chat.organization?.title || chat.title : 'Chat';
  };
  const peak = Math.max(1, ...(summary?.days.map((day) => day.requests) || [1]));
  return (
    <section aria-labelledby="project-usage-title" className="grid gap-3" aria-busy={busy}>
      <SectionHeader
        title={<span id="project-usage-title">Managed-agent usage</span>}
        actions={
          available &&
          chats.length > 0 && (
            <Hint label="Load the usage again">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Load the usage again"
                disabled={busy}
                onClick={() => void load()}
              >
                <RefreshCw size={16} className={busy ? 'animate-spin' : undefined} />
              </Button>
            </Hint>
          )
        }
      />
      <p className="form-help m-0">
        The requests that managed agents made in the chats of this project. The data comes from the
        Verdictan history. {usageValuesNote}
      </p>
      {!available ? (
        <EmptyState compact title="Usage history is not available">
          This version of the desktop bridge cannot read the Verdictan history. Update Kalkidan.
        </EmptyState>
      ) : !chats.length ? (
        <EmptyState compact title="No chats yet">
          Start a chat with a managed agent in this project. Its requests then show here.
        </EmptyState>
      ) : error ? (
        <EmptyState
          compact
          title="Usage history is not available"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
                Try again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-open-settings', {
                      detail: { section: 'managed-agents' },
                    }),
                  )
                }
              >
                Open managed agent settings
              </Button>
            </div>
          }
        >
          {error}
        </EmptyState>
      ) : !summary ? (
        <p className="form-help m-0">Loading the usage…</p>
      ) : summary.requests === 0 ? (
        <EmptyState compact title="No managed-agent requests">
          {usage!.chats.length
            ? 'Verdictan has no requests for the chats of this project yet.'
            : 'The chats of this project do not use a managed agent with this account.'}
        </EmptyState>
      ) : (
        <>
          <dl className="project-usage-stats" aria-label="Usage totals">
            <div>
              <dt>Requests</dt>
              <dd>{count(summary.requests)}</dd>
            </div>
            <div>
              <dt>Allowed</dt>
              <dd>{count(summary.allowed)}</dd>
            </div>
            <div>
              <dt>Refused</dt>
              <dd>{count(summary.refused)}</dd>
            </div>
            {summary.other > 0 && (
              <div>
                <dt>Other decisions</dt>
                <dd>{count(summary.other)}</dd>
              </div>
            )}
            <div>
              <dt>Tokens</dt>
              <dd>{tokenText(summary.tokens)}</dd>
            </div>
            <div>
              <dt>Measured cost</dt>
              <dd>{usageCostText(summary)}</dd>
            </div>
          </dl>
          {summary.tokens.unknown > 0 && (
            <p className="form-help m-0">
              {plural(summary.tokens.unknown, 'request')} with unknown token counts. The totals do
              not include them.
            </p>
          )}
          <section aria-labelledby="usage-days-title" className="grid gap-2">
            <h4 id="usage-days-title" className="text-sm font-medium">
              Requests for each day
            </h4>
            <ol className="project-usage-days" aria-label="Requests for each day, last 14 days">
              {summary.days.map((day) => (
                <li
                  key={day.date}
                  title={`${dayLabel(day.date)}: ${plural(day.requests, 'request')}`}
                >
                  <span
                    className="project-usage-bar"
                    style={{ height: `${Math.round((day.requests / peak) * 100)}%` }}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {dayLabel(day.date)}: {plural(day.requests, 'request')}
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
              <span>{dayLabel(summary.days[0].date)}</span>
              <span>{dayLabel(summary.days[summary.days.length - 1].date)}</span>
            </div>
            {summary.undated > 0 && (
              <p className="form-help m-0">
                {plural(summary.undated, 'request')} with an unknown time. The days do not show
                them.
              </p>
            )}
          </section>
          {summary.models.length > 0 && (
            <section aria-labelledby="usage-models-title" className="grid gap-2">
              <h4 id="usage-models-title" className="text-sm font-medium">
                Models
              </h4>
              <ul className="flex flex-wrap gap-2" aria-label="Models used">
                {summary.models.map((model) => (
                  <li key={model.name} className="project-usage-chip">
                    {model.name} · {plural(model.requests, 'request')}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="usage-chats-title" className="grid gap-2">
            <h4 id="usage-chats-title" className="text-sm font-medium">
              Chats
            </h4>
            <ul className="review-list" aria-label="Usage by chat">
              {summary.chats.map((chat) => (
                <li key={chat.agent + chat.sessionId} className="list-row row-hover px-2">
                  <AgentIcon agent={chat.agent as Session['agent']} />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <button
                      type="button"
                      className="truncate text-left text-[13px] leading-5 font-medium hover:underline"
                      onClick={() => openChat(chat.agent as Session['agent'], chat.sessionId)}
                    >
                      {title(chat.agent, chat.sessionId)}
                    </button>
                    <span className="truncate text-xs leading-4 text-muted-foreground">
                      {agentLabel(chat.agent)} · {plural(chat.requests, 'request')} ·{' '}
                      {count(chat.allowed)} allowed · {count(chat.refused)} refused ·{' '}
                      {tokenText(chat.tokens)}
                      {chat.models.length ? ` · ${chat.models.join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="grid shrink-0 justify-items-end gap-0.5 text-xs text-muted-foreground">
                    <span>
                      {chat.billing === 'subscription'
                        ? 'Included in your subscription'
                        : usageCostText(chat)}
                    </span>
                    {chat.lastTime && (
                      <span title={fullTime(chat.lastTime)}>
                        Last request {relativeTime(chat.lastTime)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          {(summary.partial || usage!.unmanaged > 0 || usage!.failed > 0) && (
            <ul className="form-help m-0 grid gap-1" aria-label="Notes about the usage">
              {summary.partial && (
                <li>
                  Kalkidan reads the {projectUsageLimits.chats} most recent chats and{' '}
                  {projectUsageLimits.pages * 25} requests for each chat. The totals can be
                  incomplete.
                </li>
              )}
              {usage!.unmanaged > 0 && (
                <li>
                  {plural(usage!.unmanaged, 'chat')} without managed-agent history for this account.
                </li>
              )}
              {usage!.failed > 0 && (
                <li>
                  The history of {plural(usage!.failed, 'chat')} could not be read. Load the usage
                  again.
                </li>
              )}
            </ul>
          )}
          <p className="form-help m-0">
            Requests until {fullTime(usage!.observedAt)}. Load again to see later requests.
          </p>
        </>
      )}
    </section>
  );
}
