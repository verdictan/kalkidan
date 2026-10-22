import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

/** The capability of a runtime that sends the computer name to Verdictan. */
export const hostNameCapability = 'resources.provision.host_name';

/**
 * A computer name that Verdictan accepts: 1 to 120 characters, without control characters. The
 * gateway name in Console is "<computer name> · <agent name>". Undefined when nothing is left.
 */
export function hostDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? Array.from(text).slice(0, 120).join('').trim() : undefined;
}

let local: string | undefined;
/** The name of this computer, for example "MacBook Pro". Read once. */
export function localComputerName() {
  if (local !== undefined) return local;
  let name = '';
  if (process.platform === 'darwin') {
    try {
      name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], {
        encoding: 'utf8',
        timeout: 2000,
      });
    } catch {}
  }
  local = hostDisplayName(name) || hostDisplayName(hostname().replace(/\.local$/i, '')) || '';
  return local;
}
