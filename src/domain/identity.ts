// The identity color system. Each project, repo, session and subagent session has one color from
// the palette. The shape of the mark tells the level, the color tells the item, and a separate
// status glyph tells the state. Store the color name, not the hex, so the palette can change.

/** The eight identity colors. Each is 5:1 or more on #fff and #fafafa. */
export const identityPalette = {
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  plum: '#a21caf',
  pink: '#be185d',
  cyan: '#0e7490',
  teal: '#0f766e',
  slate: '#475569',
} as const satisfies Record<string, string>;

export type IdentityColor = keyof typeof identityPalette;
export type IdentityKind = 'project' | 'repo' | 'session' | 'subagent';
export type ItemStatus = 'working' | 'needs-you' | 'failed' | 'idle';

/** The palette order, also the order of the color swatches. */
export const identityColorNames = Object.keys(identityPalette) as readonly IdentityColor[];

export const identityColorLabels: Record<IdentityColor, string> = {
  blue: 'Blue',
  indigo: 'Indigo',
  violet: 'Violet',
  plum: 'Plum',
  pink: 'Pink',
  cyan: 'Cyan',
  teal: 'Teal',
  slate: 'Slate',
};

export function isIdentityColor(value: unknown): value is IdentityColor {
  return typeof value === 'string' && Object.hasOwn(identityPalette, value);
}

/** A stable 32-bit FNV-1a hash of a name. */
export function identityHash(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The automatic color: the first palette color, in order from the hash of the name, that no
 * sibling uses. With more than eight siblings, colors repeat.
 */
export function autoIdentityColor(
  name: string,
  siblingColors: Iterable<IdentityColor> = [],
): IdentityColor {
  const used = new Set(siblingColors);
  const start = identityHash(name.trim().toLowerCase()) % identityColorNames.length;
  for (let step = 0; step < identityColorNames.length; step += 1) {
    const color = identityColorNames[(start + step) % identityColorNames.length];
    if (!used.has(color)) return color;
  }
  return identityColorNames[start];
}

export interface IdentityItem {
  /** The override key: the name for projects and repos, the id for sessions and subagents. */
  key: string;
  name: string;
  /** An explicit color, for example a color that the project stores. Overrides win over it. */
  color?: IdentityColor | null;
}

/**
 * Gives a color to each item of one sibling group. Overrides and explicit colors are reserved
 * first. The other items take the automatic color in the given order, so give the items in
 * creation order for stable results.
 */
export function assignIdentityColors(
  kind: IdentityKind,
  items: readonly IdentityItem[],
  overrides: Readonly<Record<string, IdentityColor>> = getIdentityOverrides(kind),
): Map<string, IdentityColor> {
  const result = new Map<string, IdentityColor>();
  const used: IdentityColor[] = [];
  for (const item of items) {
    const fixed = overrides[item.key] ?? item.color ?? null;
    if (fixed) {
      result.set(item.key, fixed);
      used.push(fixed);
    }
  }
  for (const item of items) {
    if (result.has(item.key)) continue;
    const color = autoIdentityColor(item.name, used);
    result.set(item.key, color);
    used.push(color);
  }
  return result;
}

/** The CSS variable of a color, for example 'var(--id-teal)'. */
export function identityVar(color: IdentityColor): string {
  return `var(--id-${color})`;
}

/** An inline style that sets --id, which marks, tints and tokens read. */
export function identityStyle(color: IdentityColor): Record<'--id', string> {
  return { '--id': identityVar(color) };
}

const statusRank: Record<ItemStatus, number> = {
  'needs-you': 3,
  failed: 2,
  working: 1,
  idle: 0,
};

/** The strongest status of the children of a collapsed parent: needs you > failed > working. */
export function strongestStatus(list: Iterable<ItemStatus | null | undefined>): ItemStatus | null {
  let best: ItemStatus | null = null;
  for (const status of list) {
    if (!status || status === 'idle') continue;
    if (!best || statusRank[status] > statusRank[best]) best = status;
  }
  return best;
}

/** Maps a project color from round 10. Red, yellow and green are not identity colors. */
export function fromLegacyProjectColor(value: string | null | undefined): IdentityColor | null {
  if (isIdentityColor(value)) return value;
  if (value === 'purple') return 'violet';
  return null;
}

// Overrides. They are stored by kind and key in localStorage, so every window sees the same
// colors. Other windows get the storage event; this window gets a custom event.
const storageKey = 'kalkidan.identity.v1';
const changeEvent = 'kalkidan-identity-change';
type OverrideStore = Record<string, IdentityColor>;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let memoryStore: OverrideStore = {};

function readStore(): OverrideStore {
  const store = storage();
  if (!store) return memoryStore;
  try {
    const value: unknown = JSON.parse(store.getItem(storageKey) || '{}');
    if (!value || typeof value !== 'object') return {};
    const result: OverrideStore = {};
    for (const [key, color] of Object.entries(value)) {
      if (isIdentityColor(color)) result[key] = color;
    }
    return result;
  } catch {
    return {};
  }
}

function writeStore(next: OverrideStore) {
  const store = storage();
  memoryStore = next;
  try {
    store?.setItem(storageKey, JSON.stringify(next));
  } catch {
    // The memory copy stays correct for this window.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(changeEvent));
}

const storeKey = (kind: IdentityKind, key: string) => `${kind}:${key}`;

/** All overrides of one kind by key, or all overrides by 'kind:key' without a kind. */
export function getIdentityOverrides(kind?: IdentityKind): Record<string, IdentityColor> {
  const all = readStore();
  if (!kind) return all;
  const prefix = `${kind}:`;
  const result: Record<string, IdentityColor> = {};
  for (const [key, color] of Object.entries(all)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = color;
  }
  return result;
}

export function getIdentityOverride(kind: IdentityKind, key: string): IdentityColor | null {
  return readStore()[storeKey(kind, key)] ?? null;
}

/** Sets the color of an item. null removes the override, so the color is automatic again. */
export function setIdentityOverride(
  kind: IdentityKind,
  key: string,
  color: IdentityColor | null,
): void {
  const next = { ...readStore() };
  if (color) next[storeKey(kind, key)] = color;
  else delete next[storeKey(kind, key)];
  writeStore(next);
}

/** Sets the colors that have no override yet. The demo uses it. */
export function seedIdentityOverrides(
  entries: readonly { kind: IdentityKind; key: string; color: IdentityColor }[],
): void {
  const current = readStore();
  const next = { ...current };
  let changed = false;
  for (const entry of entries) {
    const key = storeKey(entry.kind, entry.key);
    if (next[key]) continue;
    next[key] = entry.color;
    changed = true;
  }
  if (changed) writeStore(next);
}

/** Calls the listener when an override changes in this window or in another window. */
export function subscribeIdentityOverrides(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey) listener();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener('storage', onStorage);
  };
}

// Resolved colors. The sidebar tree knows every sibling group, so it publishes the colors that it
// resolves. Other views (chat header, task cards, pickers) read one item with identityColor and
// get the same color as the tree.
const published = new Map<string, IdentityColor>();

/** Publishes the resolved colors of one sibling group (the tree does this). */
export function publishIdentityColors(
  kind: IdentityKind,
  colors: ReadonlyMap<string, IdentityColor>,
): void {
  let changed = false;
  for (const [key, color] of colors) {
    const id = storeKey(kind, key);
    if (published.get(id) === color) continue;
    published.set(id, color);
    changed = true;
  }
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(changeEvent));
}

/**
 * The color of one item: its override, else the color that the tree published, else the
 * automatic color of its name. Keys: the name for projects and repos, the ID for sessions and
 * subagents.
 */
export function identityColor(
  kind: IdentityKind,
  key: string,
  name: string = key,
  fallback?: IdentityColor | null,
): IdentityColor {
  const id = storeKey(kind, key);
  return readStore()[id] ?? published.get(id) ?? fallback ?? autoIdentityColor(name);
}

/** The demo colors, the same in every frame. */
export const demoIdentityAssignments: readonly {
  kind: IdentityKind;
  key: string;
  color: IdentityColor;
}[] = [
  { kind: 'project', key: 'Atlas', color: 'indigo' },
  { kind: 'project', key: 'Ledger', color: 'teal' },
  { kind: 'project', key: 'Harbor', color: 'plum' },
  { kind: 'project', key: 'Payments', color: 'plum' },
  { kind: 'repo', key: 'atlas-web', color: 'blue' },
  { kind: 'repo', key: 'api-service', color: 'cyan' },
  { kind: 'repo', key: 'design-system', color: 'violet' },
];
