import { historyDecisionLabel, type ManagedHistoryEntry } from './managed-history';

/**
 * The managed-agent usage of a project. It comes from the same Verdictan history as the
 * Usage history of a chat. The backend reads the history of each chat of the project. The
 * renderer sends only the chats, never correlation keys.
 */
export interface ProjectUsageChatRef {
  agent: string;
  sessionId: string;
}

/** Who pays for the requests of a chat. A subscription has no known provider charge. */
export type ProjectUsageBilling = 'subscription' | 'metered';

export interface ProjectUsageChat extends ProjectUsageChatRef {
  billing: ProjectUsageBilling;
  /** The SSH host of the chat. A chat on this computer has no host. */
  hostId?: string;
  /** The name of the SSH host, for the label of the chat. */
  hostName?: string;
  entries: ManagedHistoryEntry[];
  /** False when the chat has more requests than Kalkidan reads. */
  complete: boolean;
}

export interface ProjectUsage {
  chats: ProjectUsageChat[];
  /** Chats without managed-agent history for the current account. */
  unmanaged: number;
  /** Chats whose history could not be read. */
  failed: number;
  /** Chats that Kalkidan did not read, because the project has too many chats. */
  skipped: number;
  observedAt: string;
}

/** The label of the computer that runs a chat. */
export function usageHostLabel(chat: Pick<ProjectUsageChat, 'hostId' | 'hostName'>) {
  return chat.hostId ? chat.hostName || 'SSH host' : 'This computer';
}

/** The limits of one read. They keep the number of Verdictan requests small. */
export const projectUsageLimits = { chats: 50, pages: 8 } as const;

export type UsageDecision = 'allowed' | 'refused' | 'other';
export function usageDecision(entry: ManagedHistoryEntry): UsageDecision {
  const label = historyDecisionLabel(entry).label;
  return label === 'Allowed' ? 'allowed' : label === 'Denied' ? 'refused' : 'other';
}

/** Adds two decimal amounts without rounding. Both are plain decimal text. */
export function addDecimal(a: string, b: string): string {
  const parse = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    return { negative, whole, fraction };
  };
  const left = parse(a);
  const right = parse(b);
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const big = (value: ReturnType<typeof parse>) =>
    (value.negative ? -1n : 1n) * BigInt(value.whole + value.fraction.padEnd(scale, '0'));
  const sum = big(left) + big(right);
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale ? digits.slice(digits.length - scale).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

export interface UsageTokens {
  input: number;
  output: number;
  cached: number;
  /** Requests with one or more unknown token counts. */
  unknown: number;
}

export interface UsageTotals {
  requests: number;
  allowed: number;
  refused: number;
  other: number;
  tokens: UsageTokens;
  /** The measured cost for each currency. Only metered requests with a known cost count. */
  cost: Record<string, string>;
  /** Metered requests without a known cost. */
  costUnknown: number;
  /** Requests that a subscription pays for. */
  subscription: number;
}

export interface UsageChatSummary extends ProjectUsageChatRef, UsageTotals {
  billing: ProjectUsageBilling;
  /** The computer that runs the chat: this computer or the name of the SSH host. */
  host: string;
  complete: boolean;
  models: string[];
  lastTime: string | null;
}

export interface ProjectUsageSummary extends UsageTotals {
  models: { name: string; requests: number }[];
  chats: UsageChatSummary[];
  /** Requests for each day, the oldest day first. */
  days: { date: string; requests: number }[];
  /** Requests without a known time. They are not in `days`. */
  undated: number;
  /** True when one or more chats have more requests than Kalkidan read. */
  partial: boolean;
}

function emptyTotals(): UsageTotals {
  return {
    requests: 0,
    allowed: 0,
    refused: 0,
    other: 0,
    tokens: { input: 0, output: 0, cached: 0, unknown: 0 },
    cost: {},
    costUnknown: 0,
    subscription: 0,
  };
}

function add(totals: UsageTotals, entry: ManagedHistoryEntry, billing: ProjectUsageBilling) {
  totals.requests++;
  totals[usageDecision(entry)]++;
  const counts = [entry.inputTokens, entry.outputTokens, entry.cachedInputTokens];
  if (counts.some((value) => value === null)) totals.tokens.unknown++;
  totals.tokens.input += Number(entry.inputTokens ?? 0);
  totals.tokens.output += Number(entry.outputTokens ?? 0);
  totals.tokens.cached += Number(entry.cachedInputTokens ?? 0);
  if (billing === 'subscription') totals.subscription++;
  else if (entry.cost !== null && entry.currency !== null)
    totals.cost[entry.currency] = addDecimal(totals.cost[entry.currency] ?? '0', entry.cost);
  else totals.costUnknown++;
}

/** The local date of a time, as YYYY-MM-DD. */
export function localDay(time: number) {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Adds up the usage of a project: totals, models, chats and requests for each day. */
export function summarizeProjectUsage(
  usage: ProjectUsage,
  now: number,
  dayCount = 14,
): ProjectUsageSummary {
  const totals = emptyTotals();
  const models = new Map<string, number>();
  const dayKeys: string[] = [];
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  for (let index = dayCount - 1; index >= 0; index--) {
    const day = new Date(start);
    day.setDate(start.getDate() - index);
    dayKeys.push(localDay(day.getTime()));
  }
  const perDay = new Map(dayKeys.map((key) => [key, 0]));
  let undated = 0;
  const chats = usage.chats.map((chat) => {
    const summary: UsageChatSummary = {
      agent: chat.agent,
      sessionId: chat.sessionId,
      billing: chat.billing,
      host: usageHostLabel(chat),
      complete: chat.complete,
      models: [],
      lastTime: null,
      ...emptyTotals(),
    };
    const chatModels = new Set<string>();
    for (const entry of chat.entries) {
      add(totals, entry, chat.billing);
      add(summary, entry, chat.billing);
      if (entry.model) {
        models.set(entry.model, (models.get(entry.model) ?? 0) + 1);
        chatModels.add(entry.model);
      }
      const time = entry.time ? Date.parse(entry.time) : NaN;
      if (Number.isFinite(time)) {
        const key = localDay(time);
        if (perDay.has(key)) perDay.set(key, perDay.get(key)! + 1);
        if (!summary.lastTime || time > Date.parse(summary.lastTime)) summary.lastTime = entry.time;
      } else undated++;
    }
    summary.models = [...chatModels].sort();
    return summary;
  });
  return {
    ...totals,
    models: [...models]
      .map(([name, requests]) => ({ name, requests }))
      .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)),
    chats: chats
      .filter((chat) => chat.requests > 0)
      .sort(
        (a, b) => b.requests - a.requests || (b.lastTime ?? '').localeCompare(a.lastTime ?? ''),
      ),
    days: dayKeys.map((date) => ({ date, requests: perDay.get(date)! })),
    undated,
    partial: usage.chats.some((chat) => !chat.complete) || usage.skipped > 0,
  };
}

/** The cost text of a total. A subscription has no invented number. */
export function usageCostText(
  totals: Pick<UsageTotals, 'cost' | 'costUnknown' | 'subscription' | 'requests'>,
) {
  const known = Object.entries(totals.cost)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => `${amount} ${currency}`);
  const parts = [...known];
  if (totals.subscription > 0)
    parts.push(
      totals.subscription === totals.requests
        ? 'Included in your subscription'
        : `${totals.subscription} included in your subscription`,
    );
  if (totals.costUnknown > 0)
    parts.push(
      totals.costUnknown === totals.requests ? 'Unknown' : `${totals.costUnknown} unknown`,
    );
  return parts.join(' · ') || 'None';
}
