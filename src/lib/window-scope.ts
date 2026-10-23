import { parseWindowScope, type WindowScope } from '../domain/desktop';

/** The scope of this window. It does not change while the window is open. */
export function currentWindowScope(): WindowScope {
  return typeof window === 'undefined'
    ? { kind: 'main' }
    : parseWindowScope(window.location.search);
}
