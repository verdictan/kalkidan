import { useEffect, useRef, useState } from 'react';
import { interfaceConfig } from '../config/interface';

const storageKey = 'kalkidan-sidebar-width';
const openKey = 'kalkidan-sidebar-open';
const { min, max, initial, contentMin, collapseBelow } = interfaceConfig.sidebar;
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

type OpenChoice = { narrow?: boolean; wide?: boolean };
const narrowWindow = () => window.innerWidth < collapseBelow;
function savedChoice(): OpenChoice {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(openKey) || '{}');
    return value && typeof value === 'object' ? (value as OpenChoice) : {};
  } catch {
    return {};
  }
}
/** The open state for a window size: the user's choice, else closed in a narrow window. */
function openFor(narrow: boolean) {
  const choice = savedChoice()[narrow ? 'narrow' : 'wide'];
  return typeof choice === 'boolean' ? choice : !narrow;
}

/**
 * The open state of the sidebar. Below 900 px the sidebar is closed by default. The user can
 * open it, and the app keeps that choice for narrow and for wide windows separately.
 */
export function useSidebarOpen() {
  const [narrow, setNarrow] = useState(narrowWindow);
  const [open, setOpenState] = useState(() => openFor(narrowWindow()));
  const sizeClass = useRef(narrow);
  useEffect(() => {
    const resize = () => {
      const next = narrowWindow();
      if (sizeClass.current === next) return;
      sizeClass.current = next;
      setNarrow(next);
      setOpenState(openFor(next));
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  /** Changes the state and keeps it as the choice for this window size. */
  function setOpen(value: boolean | ((open: boolean) => boolean)) {
    setOpenState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      try {
        localStorage.setItem(
          openKey,
          JSON.stringify({ ...savedChoice(), [narrow ? 'narrow' : 'wide']: next }),
        );
      } catch {
        /* Optional preference. */
      }
      return next;
    });
  }
  return { open, setOpen, narrow };
}
