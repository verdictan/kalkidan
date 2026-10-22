import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { API } from '../types';
import type { AppVersion } from '../domain/updates';
import { settingsAnchors } from '../domain/settings-route';
import { displayVersion, shortId } from '../lib/verdictan-labels';
import { SettingsRow } from './settings-disclosure';
import { Button } from './ui/button';

export const userGuideUrl = 'https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md';
/** The Kalkidan releases. Kalkidan does not update itself; users install each release. */
export const releasesUrl = 'https://github.com/verdictan/packages/releases?q=kalkidan';

/** Reads the Kalkidan version on open. Some test stubs do not report a version. */
export function useAppVersion(api: API, open = true) {
  const [app, setApp] = useState<AppVersion>();
  const generation = useRef(0);
  useEffect(() => {
    if (!open || typeof api.appVersion !== 'function') return;
    const token = ++generation.current;
    void Promise.resolve()
      .then(() => api.appVersion())
      .then(
        (value) => token === generation.current && setApp(value),
        () => {},
      );
  }, [api, open]);
  return app;
}

/**
 * The version row of Settings › General: "Kalkidan 0.1.0", the build, and "Check for updates ↗".
 * Kalkidan does not update itself. The link opens the release page, where the user gets the
 * new installer and the update command.
 */
export function VersionRow({ api, open = true }: { api: API; open?: boolean }) {
  const app = useAppVersion(api, open);
  const version = app?.version
    ? /^\d/.test(app.version)
      ? `Kalkidan ${displayVersion(app.version)}`
      : `Kalkidan ${app.version}`
    : 'Kalkidan';
  const build = app?.build && app.build !== 'unknown' ? `Build ${shortId(app.build)}` : '';
  return (
    <SettingsRow
      id={settingsAnchors.about}
      label={<span data-testid="settings-version">{version}</span>}
      help={build || undefined}
    >
      <Button asChild variant="ghost" size="sm">
        <a href={releasesUrl} target="_blank" rel="noreferrer">
          Check for updates
          <ExternalLink aria-label="Opens in the browser" />
        </a>
      </Button>
    </SettingsRow>
  );
}
