// The Verdictan region that Kalkidan suggests on the Welcome screen.
//
// The suggestion comes only from the time zone of this computer. Kalkidan shows it, and saves
// it only when the user selects a button (see electron/verdictan/region.ts). There is no IP
// geolocation and no network request.

export type Region = 'eu' | 'us';

export const regions: readonly Region[] = ['eu', 'us'];

export const regionNames: Record<Region, string> = {
  eu: 'European Union',
  us: 'United States',
};

/** The console address that users see in the browser when they sign in. */
export const regionConsoleHosts: Record<Region, string> = {
  eu: 'console.eu.verdictan.com',
  us: 'console.us.verdictan.com',
};

/** The current time zone, for example "Europe/Berlin". Empty when the runtime cannot tell. */
export function currentTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Suggests a region from an IANA time zone. Europe, Africa and Asia suggest the European Union.
 * The Americas suggest the United States. Other zones, for example "UTC", "Etc/GMT" or
 * "Pacific/Auckland", give no suggestion: the user must choose.
 */
export function suggestRegion(timeZone: string = currentTimeZone()): Region | undefined {
  const zone = timeZone.trim();
  if (/^(Europe|Africa|Asia)\//.test(zone)) return 'eu';
  if (/^(America|US|Canada)\//.test(zone)) return 'us';
  return undefined;
}

/** The other region, for a "Use United States" action after a region mismatch. */
export function otherRegion(region: Region): Region {
  return region === 'eu' ? 'us' : 'eu';
}

/** The host of a sign-in URL, for example "console.eu.verdictan.com". Empty when not valid. */
export function urlHost(url: string | undefined) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
