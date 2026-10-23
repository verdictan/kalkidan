import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  assignIdentityColors,
  getIdentityOverrides,
  identityColor,
  publishIdentityColors,
  subscribeIdentityOverrides,
  type IdentityColor,
  type IdentityItem,
  type IdentityKind,
} from '../domain/identity';

let snapshot: Record<string, IdentityColor> = getIdentityOverrides();
let snapshotText = JSON.stringify(snapshot);

function readSnapshot() {
  const next = getIdentityOverrides();
  const text = JSON.stringify(next);
  if (text !== snapshotText) {
    snapshot = next;
    snapshotText = text;
  }
  return snapshot;
}

/** All color overrides by 'kind:key'. Updates when a color changes in any window. */
export function useIdentityOverrides(): Readonly<Record<string, IdentityColor>> {
  return useSyncExternalStore(subscribeIdentityOverrides, readSnapshot, readSnapshot);
}

/**
 * The colors of one sibling group, by key. Give the whole group in creation order. With
 * `publish` (the sidebar tree), the colors go to identityColor, so other views agree.
 */
export function useIdentityColors(
  kind: IdentityKind,
  items: readonly IdentityItem[],
  options: { publish?: boolean } = {},
): Map<string, IdentityColor> {
  const all = useIdentityOverrides();
  const itemsKey = items.map((item) => `${item.key}\u0000${item.name}\u0000${item.color ?? ''}`);
  const signature = itemsKey.join('\u0001');
  const colors = useMemo(() => {
    const prefix = `${kind}:`;
    const overrides: Record<string, IdentityColor> = {};
    for (const [key, color] of Object.entries(all)) {
      if (key.startsWith(prefix)) overrides[key.slice(prefix.length)] = color;
    }
    return assignIdentityColors(kind, items, overrides);
    // The signature holds the item fields that change the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, all, signature]);
  const publish = Boolean(options.publish);
  useEffect(() => {
    if (publish) publishIdentityColors(kind, colors);
  }, [publish, kind, colors]);
  return colors;
}

/** The color of one item, the same as in the tree. See identityColor. */
export function useIdentityColor(
  kind: IdentityKind,
  key: string,
  name?: string,
  fallback?: IdentityColor | null,
): IdentityColor {
  const read = () => identityColor(kind, key, name, fallback);
  return useSyncExternalStore(subscribeIdentityOverrides, read, read);
}
