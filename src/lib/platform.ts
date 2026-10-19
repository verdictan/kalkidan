// Platform helpers for the renderer. The renderer cannot import Node.js, so
// they read the user agent. Tests can pass a platform name.
export type DesktopPlatform = 'mac' | 'windows' | 'linux';

export function detectPlatform(userAgent = globalThis.navigator?.userAgent ?? ''): DesktopPlatform {
  if (/Mac|iPhone|iPad/.test(userAgent)) return 'mac';
  if (/Windows/.test(userAgent)) return 'windows';
  return 'linux';
}

export const platform = detectPlatform();
export const isMac = platform === 'mac';

/** Name of the system file manager, for labels such as "Show in Finder". */
export function fileManagerName(target: DesktopPlatform = platform) {
  if (target === 'mac') return 'Finder';
  if (target === 'windows') return 'File Explorer';
  return 'file manager';
}

/** "Show in Finder", "Show in File Explorer", or "Show in file manager". */
export function revealLabel(target: DesktopPlatform = platform) {
  return `Show in ${fileManagerName(target)}`;
}

export type ShortcutKey = 'mod' | 'shift' | 'alt';

/**
 * Formats a shortcut for display. `shortcutLabel(['mod', 'shift'], 'A')` is
 * "⇧⌘A" on macOS and "Ctrl+Shift+A" on Windows and Linux.
 */
export function shortcutLabel(
  modifiers: ShortcutKey[],
  key: string,
  target: DesktopPlatform = platform,
) {
  if (target === 'mac') {
    const order: ShortcutKey[] = ['alt', 'shift', 'mod'];
    const glyph = { alt: '⌥', shift: '⇧', mod: '⌘' };
    return (
      order
        .filter((m) => modifiers.includes(m))
        .map((m) => glyph[m])
        .join('') + key
    );
  }
  const order: ShortcutKey[] = ['mod', 'alt', 'shift'];
  const name = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...order.filter((m) => modifiers.includes(m)).map((m) => name[m]), key].join('+');
}

/**
 * True when the platform's primary modifier is down: Command on macOS, Control
 * elsewhere. AltGr reports Ctrl+Alt on Windows and Linux, so a key press with
 * AltGr does not count.
 */
export function hasPrimaryModifier(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'getModifierState'>,
  target: DesktopPlatform = platform,
) {
  if (target === 'mac') return event.metaKey && !event.ctrlKey;
  if (event.getModifierState?.('AltGraph')) return false;
  return event.ctrlKey && !event.metaKey;
}

/** True when the key press comes from a text field, editor, or terminal. */
export function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  return !!element.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm',
  );
}

/** Last segment of a POSIX or Windows path. */
export function pathBasename(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** `plural(1, 'session')` is "1 session"; `plural(2, 'match', 'matches')` is "2 matches". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
