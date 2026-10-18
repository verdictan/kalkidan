import { useEffect, useState } from 'react';
import { interfaceConfig } from '../config/interface';

const storageKey = 'kalkidan-sidebar-width';
const { min, max, initial, contentMin } = interfaceConfig.sidebar;
export function useSidebarWidth() {
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= min ? Math.min(max, saved) : initial;
    } catch {
      return initial;
    }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const maximum = Math.max(min, Math.min(max, viewport - contentMin));
  const width = Math.min(preferred, maximum);
  function update(value: number) {
    const next = Math.round(Math.max(min, Math.min(maximum, value)));
    setPreferred(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      /* Optional preference. */
    }
  }
  return { width, min, maximum, initial, update };
}
