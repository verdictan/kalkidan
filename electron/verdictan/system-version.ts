import { execFileSync } from 'node:child_process';
import { release } from 'node:os';

/** Read the execution host, not a release manifest or renderer-supplied value. */
export function hostSystemVersion(): string {
  try {
    const native = process as NodeJS.Process & { getSystemVersion?: () => string };
    const value = native.getSystemVersion
      ? native.getSystemVersion()
      : process.platform === 'darwin'
        ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], {
            encoding: 'utf8',
            timeout: 2000,
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim()
        : release();
    // Kernel build suffixes are not part of the three-component version contract.
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(value);
    return match ? `${match[1]}.${match[2]}.${match[3] || '0'}` : '';
  } catch {
    // Installation fails closed if the host version cannot be read.
    return '';
  }
}
