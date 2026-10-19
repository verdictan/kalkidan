// The light or dark appearance of the app. "system" follows the operating system setting.
export type Appearance = 'system' | 'light' | 'dark';

export const appearanceStorageKey = 'kalkidan-appearance';
const themeColors = { dark: '#22272b', light: '#eef0f2' };

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
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? themeColors.dark : themeColors.light);
  };
  apply();
  if (mode !== 'system') return;
  darkScheme.addEventListener('change', apply);
  stopFollowingSystem = () => darkScheme.removeEventListener('change', apply);
}
