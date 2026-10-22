import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { API } from '../types';
import type { AppVersion, HelperUpdateStatus } from '../domain/updates';
import { settingsAnchors } from '../domain/settings-route';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { displayVersion, shortId, type StatusLabel } from '../lib/verdictan-labels';
import {
  CopyValue,
  SettingsAdvanced,
  SettingsRow,
  SettingsRows,
  StatusBadge,
} from './settings-disclosure';
import { runtimeView, useRuntimeStatus } from './verdictan-settings';
import { Button } from './ui/button';

export const userGuideUrl = 'https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md';
export const reportIssueUrl = 'https://github.com/verdictan/kalkidan/issues';
/** The Kalkidan releases. Kalkidan does not update itself; users install each release. */
export const releasesUrl = 'https://github.com/verdictan/packages/releases?q=kalkidan';

/** "Version 1.2.3 · Build 4a1a9a9 · Development build", from the app-version call. */
export function appVersionLabel(app: AppVersion | undefined) {
  const version = !app?.version
    ? 'Version not known'
    : /^\d/.test(app.version)
      ? `Version ${displayVersion(app.version)}`
      : app.version;
  const build = app?.build && app.build !== 'unknown' ? `Build ${shortId(app.build)}` : '';
  return [version, build, app && !app.packaged ? 'Development build' : '']
    .filter(Boolean)
    .join(' · ');
}

/**
 * Settings › About: the Kalkidan version with the one "Check for updates" link, the agent
 * tools, and help links. Kalkidan does not update itself. The link opens the release page,
 * where the user gets the new installer. The Advanced fold has the full build digest.
 */
export function AboutSection({
  api,
  open = true,
  onOpenComputers,
}: {
  api: API;
  open?: boolean;
  /** Opens Settings › Computers, where a runtime or a helper problem shows. */
  onOpenComputers?: () => void;
}) {
  const [app, setApp] = useState<AppVersion>();
  const [helpers, setHelpers] = useState<HelperUpdateStatus[]>([]);
  const generation = useRef(0);
  const runtime = useRuntimeStatus(api, open, 'local');
  function read() {
    const token = ++generation.current;
    // Some test stubs do not report a version or the helpers.
    if (typeof api.appVersion === 'function')
      void Promise.resolve()
        .then(() => api.appVersion())
        .then(
          (value) => token === generation.current && setApp(value),
          () => {},
        );
    if (typeof api.helperUpdates === 'function')
      void Promise.resolve()
        .then(() => api.helperUpdates())
        .then(
          (value) => token === generation.current && setHelpers(value),
          () => {},
        );
  }
  useRefreshTriggers(undefined, open, read);
  useEffect(() => {
    if (!open) return;
    return api.onRemoteHostsChange?.(read);
  }, [api, open]);
  const view = runtimeView(runtime);
  const helperUpdates = helpers.filter((h) =>
    ['available', 'waiting-for-idle'].includes(h.discovery),
  );
  const toolsStatus: StatusLabel = !runtime.status
    ? { label: 'Checking…', tone: 'secondary' }
    : view.failure
      ? { label: 'Needs attention', tone: 'destructive' }
      : view.running
        ? { label: 'Updating…', tone: 'secondary' }
        : !runtime.status.installed
          ? { label: 'Not installed', tone: 'warning' }
          : helperUpdates.length
            ? { label: 'Update waiting', tone: 'warning' }
            : { label: 'Up to date', tone: 'success' };
  const toolsAttention = ['destructive', 'warning'].includes(toolsStatus.tone);
  const build = app?.build && app.build !== 'unknown' ? app.build : '';
  return (
    <>
      <SettingsRows label="About">
        <SettingsRow
          id={settingsAnchors.about}
          icon={
            <img
              src="./brand/kalkidan-icon.svg"
              alt=""
              width="32"
              height="32"
              className="size-8 shrink-0 rounded-lg"
            />
          }
          label="Kalkidan"
          help={<span data-testid="settings-version">{appVersionLabel(app)}</span>}
        >
          <Button asChild variant="outline" size="sm">
            <a href={releasesUrl} target="_blank" rel="noreferrer">
              Check for updates
              <ExternalLink aria-label="Opens the release page in the browser" />
            </a>
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Update Kalkidan"
          help="Kalkidan does not update itself. Quit it. Then run brew upgrade --cask kalkidan, or install the new download from the release page."
        />
        <SettingsRow
          label="Agent tools"
          help={
            toolsAttention
              ? helperUpdates.length && !view.failure
                ? 'An SSH helper update waits for active work to stop.'
                : view.help
              : 'Managed agents and SSH helpers update by themselves.'
          }
        >
          <StatusBadge status={toolsStatus} />
          {toolsAttention && onOpenComputers && (
            <Button variant="ghost" size="sm" onClick={onOpenComputers}>
              Open Computers
            </Button>
          )}
        </SettingsRow>
        <SettingsRow label="Help" help="Guides and problem reports.">
          <ExternalTextLink href={userGuideUrl}>User guide</ExternalTextLink>
          <ExternalTextLink href={reportIssueUrl}>Report an issue</ExternalTextLink>
        </SettingsRow>
      </SettingsRows>
      {build && (
        <SettingsAdvanced>
          <SettingsRows>
            <SettingsRow label="Build" help={<CopyValue value={build} name="Build" />} />
          </SettingsRows>
        </SettingsAdvanced>
      )}
    </>
  );
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-xs leading-4 text-link outline-none hover:underline focus-visible:shadow-[var(--focus-ring)]"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}
