import { agentMinimumVersions, compareVersionCores } from './agent-version';

/**
 * The support window of Kalkidan and Verdictan. The source of truth is Verdictan
 * `cli/docs/contracts/desktop-support-window.v1.json`. `contracts/verdictan` has a pinned copy,
 * and `tests/verdictan-contracts.test.ts` makes sure that these values agree with that copy.
 * See `docs/compatibility.md`.
 */
export const supportWindow = {
  protocol: { current: 1, supported: [1] as readonly number[] },
  runtime: {
    /** The current release and the two releases before it. */
    supported: ['0.6.8', '0.6.9', '0.6.10'] as readonly string[],
    minimum: '0.6.8',
    newestVerified: '0.6.10',
    /** The oldest runtime that can run the one-time Kalkidan setup (`setup.bootstrap`). */
    setupMinimum: '0.6.6',
    noticeDays: 90,
    deprecations: [
      {
        // Each version older than the window, also versions before 0.6.6.
        minimum: '0.0.0',
        maximum: '0.6.7',
        replacement: '0.6.8',
        deprecated: '2026-10-22',
        endOfSupport: '2027-01-20',
      },
    ],
  },
  desktop: { minimum: '0.1.0' },
  agents: agentMinimumVersions,
} as const;

export type RuntimeSupport = 'supported' | 'deprecated' | 'unsupported' | 'unknown';
export interface RuntimeCompatibility {
  status: RuntimeSupport;
  version?: string;
  minimum: string;
  /** The day on which a deprecated version becomes unsupported (YYYY-MM-DD). */
  endOfSupport?: string;
  replacement?: string;
  /** Plain words for the UI. Empty for a supported version. */
  message: string;
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Compares a Verdictan runtime version with the support window. A version in the window, or a
 * newer one, is supported. A deprecated version works until its end-of-support date. Each other
 * older version is unsupported.
 */
export function runtimeCompatibility(version: unknown, now = Date.now()): RuntimeCompatibility {
  const minimum = supportWindow.runtime.minimum;
  const order = compareVersionCores(version, minimum);
  if (order === undefined)
    return {
      status: 'unknown',
      minimum,
      message: 'Kalkidan cannot read the version of the Verdictan runtime.',
    };
  const value = version as string;
  if (order >= 0) return { status: 'supported', version: value, minimum, message: '' };
  const today = day(now);
  for (const entry of supportWindow.runtime.deprecations) {
    if (
      (compareVersionCores(value, entry.minimum) ?? -1) < 0 ||
      (compareVersionCores(value, entry.maximum) ?? 1) > 0
    )
      continue;
    const detail = { version: value, minimum, endOfSupport: entry.endOfSupport };
    if (today >= entry.endOfSupport)
      return {
        status: 'unsupported',
        ...detail,
        replacement: entry.replacement,
        message: `Support for Verdictan runtime ${value} stopped on ${entry.endOfSupport}. Update the runtime to ${entry.replacement} or later in Settings › Computers.`,
      };
    return {
      status: 'deprecated',
      ...detail,
      replacement: entry.replacement,
      message: `Verdictan runtime ${value} is deprecated. Support stops on ${entry.endOfSupport}. Update the runtime to ${entry.replacement} or later.`,
    };
  }
  return {
    status: 'unsupported',
    version: value,
    minimum,
    message: `Verdictan runtime ${value} is older than ${minimum}, the oldest version that Kalkidan supports. Update the runtime in Settings › Computers.`,
  };
}

/** True when a broker protocol range includes the protocol that Kalkidan sends. */
export function protocolSupported(min: number, max: number) {
  const current = supportWindow.protocol.current;
  return min <= current && current <= max;
}

/** The Settings text when the runtime is too old to run the Kalkidan setup. */
export const runtimeSetupNotice = `This Verdictan runtime cannot finish the Kalkidan setup. The setup needs runtime ${supportWindow.runtime.setupMinimum} or later. Update the runtime in Settings › Computers, then open this window again.`;
