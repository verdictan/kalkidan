// The light or dark appearance of the app. "system" follows the operating system setting.
export type Appearance = 'system' | 'light' | 'dark';

export const appearanceStorageKey = 'kalkidan-appearance';

export function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The saved appearance. Returns "system" when nothing is saved or storage is not available. */
export function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(appearanceStorageKey);
    return isAppearance(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Saves the appearance for the next start. The app still works without browser storage. */
export function saveAppearance(mode: Appearance) {
  try {
    localStorage.setItem(appearanceStorageKey, mode);
  } catch {
    /* The appearance applies for this run only. */
  }
}

/**
 * The appearance in a "?scheme=" or "?theme=" query, for example "?scheme=dark".
 * Returns null when the query has no valid value.
 */
export function schemeFromSearch(search = location.search): 'dark' | 'light' | null {
  const query = new URLSearchParams(search);
  const value = query.get('scheme') ?? query.get('theme');
  return value === 'dark' || value === 'light' ? value : null;
}

let stopFollowingSystem: (() => void) | undefined;

/**
 * Applies the appearance to the document. For "system", the document follows
 * changes to the operating system setting until the next call.
 */
export function applyAppearance(mode: Appearance) {
  stopFollowingSystem?.();
  stopFollowingSystem = undefined;
  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = mode === 'dark' || (mode === 'system' && darkScheme.matches);
    document.documentElement.classList.toggle('dark', dark);
    // The window frame uses the same colour as the title bar. Read it from the theme
    // after the class changes, so that the colour has one source.
    const chrome = getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim();
    if (chrome) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);
  };
  apply();
  if (mode !== 'system') return;
  darkScheme.addEventListener('change', apply);
  stopFollowingSystem = () => darkScheme.removeEventListener('change', apply);
}
