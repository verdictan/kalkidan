import { readFile } from 'node:fs/promises';
import { writeJSON } from './atomic-json';

export type AppearanceMode = 'system' | 'light' | 'dark';

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Reads the saved appearance. Returns "system" when the file is missing or not valid. */
export async function readAppearanceMode(file: string): Promise<AppearanceMode> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))?.mode;
    return isAppearanceMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export async function saveAppearanceMode(file: string, mode: AppearanceMode) {
  if (!isAppearanceMode(mode)) throw new Error('Invalid appearance');
  await writeJSON(file, { mode });
}

/**
 * Adds the resolved color scheme to the start URL of a window. The page applies it before
 * the first render, so that the window does not show the wrong colors at startup.
 */
export function withScheme(base: string, dark: boolean, hash = '') {
  return base + '?scheme=' + (dark ? 'dark' : 'light') + hash;
}
