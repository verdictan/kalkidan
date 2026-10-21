import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';

export type VerdictanRegion = 'eu' | 'us';
/**
 * Each region has fixed origins and its own secure profile. Do not add the global
 * `api.verdictan.com` host: it sends a cross-host geo-redirect, and an authenticated request
 * must never follow a redirect to another host. The legacy `kalkidan` profile stays unused,
 * so a region choice never reuses a sign-in from another region.
 */
const regions = {
  eu: {
    apiOrigin: 'https://api.eu.verdictan.com',
    consoleOrigin: 'https://console.eu.verdictan.com',
    profile: 'kalkidan-eu',
  },
  us: {
    apiOrigin: 'https://api.us.verdictan.com',
    consoleOrigin: 'https://console.us.verdictan.com',
    profile: 'kalkidan-us',
  },
} as const;
export function isVerdictanRegion(value: unknown): value is VerdictanRegion {
  return value === 'eu' || value === 'us';
}
export function verdictanRegion(value: unknown) {
  if (!isVerdictanRegion(value)) throw new Error('Select the EU or US Verdictan region.');
  return { ...regions[value] };
}
/**
 * An operator can preselect a region with KALKIDAN_VERDICTAN_REGION=eu or us. Any other
 * value, including the legacy `global`, leaves the region unselected.
 */
export function configuredVerdictanRegion(value = process.env.KALKIDAN_VERDICTAN_REGION) {
  return isVerdictanRegion(value) ? value : undefined;
}
/**
 * Returns undefined until the user selects a region. A saved legacy `global` value, a damaged
 * file, or an unknown value never selects a region automatically. Thus no account changes
 * without an explicit choice.
 */
export async function savedVerdictanRegion(root: string): Promise<VerdictanRegion | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(root, 'verdictan-region.json'), 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    return configuredVerdictanRegion();
  }
  try {
    const region = JSON.parse(raw)?.region;
    return isVerdictanRegion(region) ? region : undefined;
  } catch {
    return undefined;
  }
}
export async function saveVerdictanRegion(root: string, region: unknown) {
  verdictanRegion(region);
  await writeJSON(join(root, 'verdictan-region.json'), { region });
}
