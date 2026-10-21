import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';
/** Operator configuration selects fixed origins. Credentials stay in a region-specific profile. */
export function verdictanRegion(value = process.env.KALKIDAN_VERDICTAN_REGION || 'global') {
  if (value === 'global')
    return {
      apiOrigin: 'https://api.verdictan.com',
      consoleOrigin: 'https://console.verdictan.com',
      profile: 'kalkidan',
    };
  if (value === 'eu')
    return {
      apiOrigin: 'https://api.eu.verdictan.com',
      consoleOrigin: 'https://console.eu.verdictan.com',
      profile: 'kalkidan-eu',
    };
  throw new Error('Set KALKIDAN_VERDICTAN_REGION to global or eu, then restart Kalkidan.');
}

export async function savedVerdictanRegion(root: string) {
  try {
    const value = JSON.parse(await readFile(join(root, 'verdictan-region.json'), 'utf8'));
    if (value.region !== 'global' && value.region !== 'eu') throw Error('Invalid saved region.');
    return value.region as 'global' | 'eu';
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    return verdictanRegion().profile === 'kalkidan-eu' ? 'eu' : 'global';
  }
}
export async function saveVerdictanRegion(root: string, region: string) {
  verdictanRegion(region);
  await writeJSON(join(root, 'verdictan-region.json'), { region });
}
