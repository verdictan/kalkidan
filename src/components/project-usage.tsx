import { useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { API, Project, ProjectGroup, Session } from '../types';
import {
  summarizeProjectUsage,
  type ProjectUsage,
  type ProjectUsageSummary,
  type UsageTotals,
} from '../domain/project-usage';
import { managedErrorInfo } from '../domain/verdictan';
import { assignIdentityColors, identityVar, type IdentityColor } from '../domain/identity';
import { useIdentityOverrides } from '../hooks/use-identity';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { sessionRepo } from '../lib/session-repository';
import { cn } from '../lib/utils';
import { openChat } from './planning-kit';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { menuCollisionPadding, menuItemClass, menuSurfaceClass } from './ui/menu-styles';

const count = (value: number) => value.toLocaleString('en-US');
// The last usage of each project in this window. It shows at once while the usage loads
// again. It is for a short time only, as the backend cache.
const recentUsageMs = 60_000;
const recentUsage = new Map<string, { at: number; usage: ProjectUsage }>();
function cachedUsage(key: string) {
  const value = recentUsage.get(key);
  return value && Date.now() - value.at < recentUsageMs ? value.usage : undefined;
}

/** The new Settings section for each old section name. New names stay the same. */
const settingsSections: Record<string, string> = {
  'managed-agents': 'account',
  accounts: 'account',
  updates: 'about',
  'remote-hosts': 'computers',
};
const signInCodes = ['desktop.auth_required', 'desktop.auth_expired', 'desktop.account_invalid'];

/**
 * What the user can do about a usage error: try again, sign in, open a Settings section, or
 * nothing (for example in the browser preview, which has no history).
 */
export function usageErrorAction(
  message: string,
):
  | { kind: 'retry' }
  | { kind: 'sign-in' }
  | { kind: 'settings'; section: string }
  | { kind: 'none' } {
  const code = /\[(desktop\.[a-z_]{1,100})\]/.exec(message)?.[1];
  if (!code) return /desktop app/i.test(message) ? { kind: 'none' } : { kind: 'retry' };
  if (signInCodes.includes(code)) return { kind: 'sign-in' };
  const info = managedErrorInfo(code);
  if (info.retry) return { kind: 'retry' };
  if (info.section)
    return { kind: 'settings', section: settingsSections[info.section] || info.section };
  return { kind: 'none' };
}

/** The number of days that the Usage card shows. */
export const usageDays = 14;

/** The usage of the last `days` days only: requests without a time or before that go. */
export function recentProjectUsage(usage: ProjectUsage, now: number, days = usageDays) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return {
    ...usage,
    chats: usage.chats.map((chat) => ({
      ...chat,
      entries: chat.entries.filter((entry) => {
        const time = entry.time ? Date.parse(entry.time) : NaN;
        return Number.isFinite(time) && time >= start.getTime();
      }),
    })),
  };
}

/**
 * A cost as one short text: "$18.40", "€3.10 · $2.00", "Included" for a subscription, or "" when
 * there is nothing to show. "≈ " marks a total that misses requests (unknown costs or chats that
 * Kalkidan did not read).
 */
export function costText(
  totals: Pick<UsageTotals, 'cost' | 'costUnknown' | 'subscription' | 'requests'>,
  partial = false,
) {
  const amounts = Object.entries(totals.cost)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => {
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
          Number(amount),
        );
      } catch {
        return `${amount} ${currency}`;
      }
    });
  if (!amounts.length)
    return totals.requests && totals.subscription === totals.requests ? 'Included' : '';
  const rough = partial || totals.costUnknown > 0;
  return (rough ? '≈ ' : '') + amounts.join(' · ');
}

/** The time of a usage read. Without a valid time, now. */
function observedTime(usage: ProjectUsage) {
  return Date.parse(usage.observedAt) || Date.now();
}

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The window event that opens the Usage card of a project. detail: { groupId, taskId? }. */
export const openProjectUsageEvent = 'kalkidan-open-project-usage';

/** Opens the Usage card of a project. The shell mounts one ProjectUsageSheetHost. */
export function openProjectUsage(groupId: string, taskId?: string) {
  window.dispatchEvent(new CustomEvent(openProjectUsageEvent, { detail: { groupId, taskId } }));
}

interface UsageProps {
  api: API;
  group: ProjectGroup;
  /** The chats of the app. The card keeps the chats of this project. */
  sessions?: Session[];
  /** The code folders of the app. Without them, the card reads them once. */
  repos?: Project[];
}

/**
 * The managed-agent usage of a project for the last 14 days. It loads when `active` is true,
 * and again when the window gets focus.
 */
function useProjectUsage({ api, group, sessions: sessionsProp, repos: reposProp }: UsageProps) {
  const [loaded, setLoaded] = useState<{ sessions: Session[]; projects: Project[] }>();
  const needsSnapshot = !sessionsProp || !reposProp;
  useEffect(() => {
    if (!needsSnapshot || loaded) return;
    let live = true;
    api
      .snapshot()
      .then((value) => live && setLoaded({ sessions: value.sessions, projects: value.projects }))
      .catch(() => live && setLoaded({ sessions: [], projects: [] }));
    return () => {
      live = false;
    };
  }, [api, needsSnapshot, !!loaded]);
  const sessions = sessionsProp || loaded?.sessions;
  const repos = reposProp || loaded?.projects;
  const repoIds = group.repoIds.join(',');
  const own = useMemo(
    () => (repos || []).filter((repo) => repoIds.split(',').includes(repo.id)),
    [repos, repoIds],
  );
  const chats = useMemo(
    () =>
      sessions && repos
        ? sessions.filter(
            (session) => !session.id.startsWith('draft-') && !!sessionRepo(session, own),
          )
        : undefined,
    [sessions, repos, own],
  );
  const key = group.id + '|' + (chats || []).map((chat) => `${chat.agent}:${chat.id}`).join(',');
  const [usage, setUsage] = useState<ProjectUsage | undefined>(() => cachedUsage(key));
  const [error, setError] = useState('');
  const available = typeof api.projectUsage === 'function';
  const current = useRef(key);
  current.current = key;
  async function load(fresh = false) {
    if (!available || !chats?.length) return;
    const requested = key;
    setError('');
    try {
      const next = await api.projectUsage(
        group.id,
        chats.map((chat) => ({ agent: chat.agent, sessionId: chat.id })),
        fresh ? { fresh: true } : undefined,
      );
      recentUsage.set(requested, { at: Date.now(), usage: next });
      if (current.current === requested) setUsage(next);
    } catch (failure) {
      recentUsage.delete(requested);
      if (current.current === requested) {
        setUsage(undefined);
        setError(errorMessage(failure));
      }
    }
  }
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!chats) return;
    setUsage(cachedUsage(key));
    void loadRef.current();
  }, [key, !!chats, available]);
  useEffect(() => {
    const focus = () => {
      if (!document.hidden) void loadRef.current();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  const summary = useMemo<ProjectUsageSummary | null>(() => {
    if (!usage) return null;
    const now = observedTime(usage);
    return summarizeProjectUsage(recentProjectUsage(usage, now), now, usageDays);
  }, [usage]);
  const partial = !!summary?.partial || !!usage?.failed;
  return {
    chats,
    own,
    summary,
    partial,
    error,
    available,
    loading: !!chats?.length && !usage && !error,
    reload: () => void load(true),
  };
}

/** The short cost text for the Usage row, for example "$18.40", or "" while it loads. */
export function useProjectUsageCost(props: UsageProps) {
  const { summary, partial } = useProjectUsage(props);
  return summary ? costText(summary, partial) : '';
}

/** The identity color of each chat: the colors of the sessions of its repository. */
function useSessionColors(chats: Session[] | undefined, repos: Project[]) {
  const overrides = useIdentityOverrides();
  return useMemo(() => {
    const colors = new Map<string, IdentityColor>();
    const prefix = 'session:';
    const own: Record<string, IdentityColor> = {};
    for (const [key, color] of Object.entries(overrides))
      if (key.startsWith(prefix)) own[key.slice(prefix.length)] = color;
    for (const repo of repos) {
      const siblings = (chats || []).filter((chat) => sessionRepo(chat, repos)?.id === repo.id);
      const assigned = assignIdentityColors(
        'session',
        siblings.map((chat) => ({ key: chat.id, name: chat.title || chat.id })),
        own,
      );
      for (const [key, color] of assigned) colors.set(key, color);
    }
    return colors;
  }, [chats, repos, overrides]);
}

/**
 * The Usage card of a project: the cost of the last 14 days, the requests and the requests
 * that the gateway refused, the requests for each day, and the sessions by cost. A session row
 * opens the chat. The tokens show in the tooltip of a row.
 */
export function ProjectUsageCard(props: UsageProps & { className?: string }) {
  const usage = useProjectUsage(props);
  const { summary, chats, own, partial, error } = usage;
  const colors = useSessionColors(chats, own);
  const title = (id: string) => chats?.find((chat) => chat.id === id)?.title || 'Chat';
  const peak = Math.max(1, ...(summary?.days.map((day) => day.requests) || [1]));
  const rows = (summary?.chats || [])
    .map((chat) => ({ chat, cost: costText(chat), amount: Number(Object.values(chat.cost)[0]) }))
    .sort((a, b) => (b.amount || 0) - (a.amount || 0) || b.chat.requests - a.chat.requests)
    .slice(0, 5);
  const errorAction = error ? usageErrorAction(error) : undefined;
  return (
    <section
      className={cn('usage-card', props.className)}
      aria-label={`Usage of ${props.group.name}`}
      aria-busy={usage.loading}
    >
      <p className="usage-card-label">
        {props.group.name} · last {usageDays} days
      </p>
      {!usage.available ? (
        <p className="usage-card-note">This version of Kalkidan cannot read the usage.</p>
      ) : chats && !chats.length ? (
        <p className="usage-card-note">No sessions yet.</p>
      ) : error ? (
        <p className="usage-card-note">
          {errorAction?.kind === 'none' ? 'Usage shows in the desktop app.' : error}{' '}
          {errorAction?.kind === 'retry' && (
            <button type="button" className="usage-card-link" onClick={usage.reload}>
              Try again
            </button>
          )}
          {errorAction?.kind === 'sign-in' && (
            <button
              type="button"
              className="usage-card-link"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('kalkidan-sign-in', { detail: { intent: 'login' } }),
                )
              }
            >
              Sign in
            </button>
          )}
        </p>
      ) : !summary ? (
        <p className="usage-card-note">Loading…</p>
      ) : (
        <>
          <p className="usage-card-cost">{costText(summary, partial) || '$0.00'}</p>
          <p className="usage-card-label">
            {plural(summary.requests, 'request')} · {count(summary.refused)} refused
          </p>
          <ol className="usage-card-days" aria-label={`Requests for each day`}>
            {summary.days.map((day, index) => (
              <li
                key={day.date}
                title={`${dayLabel(day.date)}: ${plural(day.requests, 'request')}`}
                data-today={index === summary.days.length - 1 || undefined}
              >
                <span
                  aria-hidden="true"
                  style={{ height: `${Math.max(2, Math.round((day.requests / peak) * 48))}px` }}
                />
                <span className="sr-only">
                  {dayLabel(day.date)}: {plural(day.requests, 'request')}
                </span>
              </li>
            ))}
          </ol>
          <div className="usage-card-axis" aria-hidden="true">
            <span>{dayLabel(summary.days[0].date)}</span>
            <span>Today</span>
          </div>
          {rows.length > 0 && (
            <ul className="usage-card-sessions" aria-label="Usage by session">
              {rows.map(({ chat, cost }) => {
                const color = colors.get(chat.sessionId);
                return (
                  <li key={chat.agent + chat.sessionId}>
                    <button
                      type="button"
                      title={`${count(chat.tokens.input)} in · ${count(chat.tokens.output)} out · ${count(chat.tokens.cached)} cached`}
                      onClick={() => openChat(chat.agent as Session['agent'], chat.sessionId)}
                    >
                      <span
                        className="usage-card-dot"
                        aria-hidden="true"
                        style={color ? { background: identityVar(color) } : undefined}
                      />
                      <span className="usage-card-title">{title(chat.sessionId)}</span>
                      <span className="usage-card-amount">
                        {cost || plural(chat.requests, 'request')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const usageTriggerClass = cn(menuItemClass, 'usage-menu-row');
/** The card is 8px from the menu edge. The row is 4px inside the edge, so 12px from the row. */
const usageCardGap = 12;
/** The card can go up to the title bar (40px), as high as the menu beside it. */
const usageCardPadding = { ...menuCollisionPadding, top: 40 };

/**
 * The Usage card starts at the top of the menu, not at the Usage row (KN-B4). The trigger
 * measures how far its row is from the top of the menu each time it opens the card.
 */
function useMenuTopAlign() {
  const [offset, setOffset] = useState(0);
  const measure = (row: HTMLElement) => {
    const menu = row.closest('[role="menu"]');
    if (!menu) return;
    // Layout offsets, not screen boxes: the menu can still scale in while it opens.
    if (menu instanceof HTMLElement && row.offsetParent === menu.offsetParent)
      setOffset(menu.offsetTop - row.offsetTop);
  };
  return {
    offset,
    trigger: {
      onPointerEnter: (event: { currentTarget: HTMLElement }) => measure(event.currentTarget),
      onFocus: (event: { currentTarget: HTMLElement }) => measure(event.currentTarget),
    },
  };
}

/**
 * The Usage row of the project menu: "Usage" with the cost on the right. Hover, the right arrow
 * key or a click shows the Usage card beside the menu. Put it in a DropdownMenuContent.
 */
export function ProjectUsageMenuItem(props: UsageProps) {
  const cost = useProjectUsageCost(props);
  const align = useMenuTopAlign();
  return (
    <DropdownMenuPrimitive.Sub>
      <DropdownMenuPrimitive.SubTrigger className={usageTriggerClass} {...align.trigger}>
        Usage
        {cost && <span className="usage-menu-cost">{cost}</span>}
      </DropdownMenuPrimitive.SubTrigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.SubContent
          className={cn(menuSurfaceClass, 'usage-card-surface')}
          collisionPadding={usageCardPadding}
          sideOffset={usageCardGap}
          alignOffset={align.offset}
        >
          <ProjectUsageCard {...props} />
        </DropdownMenuPrimitive.SubContent>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Sub>
  );
}

/** The same Usage row for a right-click menu (ContextMenu.Content). */
export function ProjectUsageContextMenuItem(props: UsageProps) {
  const cost = useProjectUsageCost(props);
  const align = useMenuTopAlign();
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={usageTriggerClass} {...align.trigger}>
        Usage
        {cost && <span className="usage-menu-cost">{cost}</span>}
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent
          className={cn(menuSurfaceClass, 'usage-card-surface')}
          collisionPadding={usageCardPadding}
          sideOffset={usageCardGap}
          alignOffset={align.offset}
        >
          <ProjectUsageCard {...props} />
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

/**
 * Shows the Usage card in a small dialog when a `kalkidan-open-project-usage` event names a
 * project (⌘K "Usage", a link from a chat). The shell mounts it once.
 */
export function ProjectUsageSheetHost({
  api,
  groups,
  sessions,
  repos,
}: {
  api: API;
  groups: ProjectGroup[];
  sessions?: Session[];
  repos?: Project[];
}) {
  const [groupId, setGroupId] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: unknown }>).detail;
      if (typeof detail?.groupId !== 'string') return;
      setGroupId(detail.groupId);
      setOpen(true);
    };
    window.addEventListener(openProjectUsageEvent, show);
    return () => window.removeEventListener(openProjectUsageEvent, show);
  }, []);
  const group = groups.find((value) => value.id === groupId);
  if (!group) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="usage-dialog" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Usage</DialogTitle>
        <ProjectUsageCard
          key={group.id}
          api={api}
          group={group}
          sessions={sessions}
          repos={repos}
        />
      </DialogContent>
    </Dialog>
  );
}
