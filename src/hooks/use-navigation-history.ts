import { useEffect, useState } from 'react';

/** In-app location history; transient UI and conversation drafts stay in their owners. */
export function useNavigationHistory<T>(
  value: T,
  keyOf: (value: T) => string,
  restore: (value: T) => void,
) {
  const [history, setHistory] = useState<{ entries: T[]; index: number }>({
    entries: [value],
    index: 0,
  });
  const key = keyOf(value);
  useEffect(() => {
    setHistory((current) =>
      keyOf(current.entries[current.index]) === key
        ? current
        : {
            entries: [...current.entries.slice(0, current.index + 1), value].slice(-100),
            index: Math.min(current.index + 1, 99),
          },
    );
  }, [key]);
  function travel(delta: number) {
    const index = history.index + delta;
    if (index < 0 || index >= history.entries.length) return;
    setHistory({ ...history, index });
    restore(history.entries[index]);
  }
  return {
    canBack: history.index > 0,
    canForward: history.index < history.entries.length - 1,
    back: () => travel(-1),
    forward: () => travel(1),
    replace: (map: (entry: T) => T) =>
      setHistory((current) => ({ ...current, entries: current.entries.map(map) })),
  };
}
