import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Plus,
  RotateCw,
  SquareTerminal,
  Asterisk,
} from 'lucide-react';
import type { API, RemoteHost } from '../types';
import {
  toolDetail,
  toolInstallUrls,
  toolNames,
  type ComputerTools,
  type DesktopAPI,
  type ToolStatus,
} from '../domain/desktop';
import { settingsAnchors } from '../domain/settings-route';
import { errorMessage } from '../lib/errors';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import { AddHostForm } from './computers-settings';
import { ConfirmDialog } from './confirm-dialog';
import { useRemoteHosts } from './remote-host-picker';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { menuDestructiveClass } from './ui/menu-styles';
import { MoreButton } from './ui/more-button';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';

/** The short region names of the Tools line: "Through Verdictan · EU". */
const regionShortNames: Record<string, string> = { eu: 'EU', us: 'US' };

/** The tool detection of the desktop. The browser preview without the demo has none. */
function desktop(api: API) {
  return api as API & DesktopAPI;
}

/**
 * The tools of this computer and of each SSH host. It reads when it becomes active and after
 * each new check of the desktop. `checkAgain` runs a new check of every computer.
 */
export function useComputerTools(api: API, active = true) {
  const supported = typeof desktop(api).computerTools === 'function';
  const [computers, setComputers] = useState<ComputerTools[]>();
  const [checking, setChecking] = useState(false);
  const live = useRef(true);
  const read = useCallback(
    async (fresh = false) => {
      if (!supported) return;
      try {
        const next = await desktop(api).computerTools!(fresh ? { fresh: true } : undefined);
        if (live.current) setComputers(next);
      } catch {
        if (live.current) setComputers((current) => current || []);
      }
    },
    [api, supported],
  );
  useEffect(() => {
    live.current = true;
    if (!active || !supported) return;
    void read();
    const stop = desktop(api).onToolsChange?.((computer) =>
      setComputers((current) =>
        current?.some((item) => item.computer === computer.computer)
          ? current.map((item) => (item.computer === computer.computer ? computer : item))
          : [...(current || []), computer],
      ),
    );
    return () => {
      live.current = false;
      stop?.();
    };
  }, [api, active, supported, read]);
  async function checkAgain() {
    setChecking(true);
    try {
      await read(true);
    } finally {
      if (live.current) setChecking(false);
    }
  }
  return {
    supported,
    computers,
    local: computers?.find((computer) => computer.computer === 'local'),
    checking,
    checkAgain,
  };
}

/** The order of the tool rows: Codex, Claude Code, other agents, then the GitHub CLI. */
export function sortTools(tools: ToolStatus[] | undefined) {
  const rank = (tool: ToolStatus) =>
    tool.tool === 'codex' ? 0 : tool.tool === 'claude' ? 1 : tool.kind === 'agent' ? 2 : 3;
  return [...(tools || [])].sort((a, b) => rank(a) - rank(b));
}

/** Restarts Kalkidan, so it finds the tools that the user installed. */
export function restartKalkidan(api: API) {
  const restart = desktop(api).restartApp;
  if (typeof restart !== 'function') {
    window.location.reload();
    return;
  }
  void restart().catch(() =>
    showToast({ message: 'Kalkidan did not restart. Quit and open it again.', tone: 'error' }),
  );
}

/** The 16px icon of a tool. */
export function ToolIcon({ tool }: { tool: ToolStatus['tool'] }) {
  if (tool === 'gh')
    return <img src="./icons/github.svg" width="16" height="16" alt="" aria-hidden="true" />;
  if (tool === 'claude') return <Asterisk aria-hidden="true" />;
  return <SquareTerminal aria-hidden="true" />;
}

/** A link to the official page of a tool: "Install guide ↗" or the host name of the page. */
export function ToolLink({ tool, children }: { tool: ToolStatus['tool']; children?: ReactNode }) {
  return (
    <a
      className="st-link"
      href={toolInstallUrls[tool]}
      target="_blank"
      rel="noreferrer"
      aria-label={`${toolNames[tool]} install guide (opens in the browser)`}
    >
      {children || 'Install guide'}
      <ExternalLink aria-hidden="true" />
    </a>
  );
}

/** A green check for a tool that is ready, else an amber "!". */
export function ToolStateGlyph({ ready, label }: { ready: boolean; label: string }) {
  return ready ? (
    <Check className="st-tool-ok" role="img" aria-label={label} />
  ) : (
    <CircleAlert className="st-tool-warn" role="img" aria-label={label} />
  );
}

/** The meta of a tool row in Settings: "0.164.0 · signed in", or "2.62.0 · @dana-kim". */
function settingsMeta(tool: ToolStatus) {
  if (!tool.installed) return '';
  if (tool.state === 'error') return `${tool.version || 'Version unknown'} · does not run`;
  const parts = [tool.version || 'Version unknown'];
  if (tool.signedIn === 'yes') parts.push(tool.account ? `@${tool.account}` : 'signed in');
  else if (tool.signedIn === 'no') parts.push('not signed in');
  if (tool.kind === 'github' && tool.signedIn === 'yes' && tool.access === 'missing')
    parts.push('no repo access');
  return parts.join(' · ');
}

/** The words of the state, for the glyph and screen readers. */
function stateLabel(tool: ToolStatus) {
  if (tool.state === 'ready') return 'Ready';
  if (tool.state === 'missing') return 'Not installed';
  if (tool.state === 'signed-out') return 'Not signed in';
  if (tool.state === 'no-access') return 'No repo access';
  return 'Does not run';
}

/**
 * One tool in Settings › Tools: a 28px tile with the icon, the name, the version and the
 * sign-in, and a check or an amber "!". A tool that is not ready links to its official page.
 */
export function ToolRow({ tool }: { tool: ToolStatus }) {
  const ready = tool.state === 'ready';
  const meta = settingsMeta(tool);
  return (
    <li
      className="st-row st-tool"
      data-state={tool.state}
      id={tool.tool === 'gh' ? settingsAnchors.github : undefined}
      title={tool.path}
    >
      <span className="st-tile">
        <ToolIcon tool={tool.tool} />
      </span>
      <span className="st-row-title">{tool.name}</span>
      {meta && <span className="st-row-meta">{meta}</span>}
      {!ready && <ToolLink tool={tool.tool} />}
      <ToolStateGlyph ready={ready} label={stateLabel(tool)} />
    </li>
  );
}

/** "Installed something? Restart Kalkidan to find it." and, when it fits, Restart Kalkidan. */
export function RestartLine({ api, button = false }: { api: API; button?: boolean }) {
  return (
    <span className="st-restart">
      Installed something? Restart Kalkidan to find it.
      {button && (
        <Button variant="link" size="sm" onClick={() => restartKalkidan(api)}>
          Restart Kalkidan
        </Button>
      )}
    </span>
  );
}

/**
 * Settings › Tools: the agent CLIs and the GitHub CLI that Kalkidan finds on this computer and
 * on each SSH host. Kalkidan does not install, update, sign in to or set up these tools. A tool
 * that is not ready links to its official page. "Check again" runs a new check.
 */
export function ToolsPart({ api, open }: { api: API; open: boolean }) {
  const tools = useComputerTools(api, open);
  const { status } = useVerdictanStatus(api, open);
  const { hosts, setHosts } = useRemoteHosts(api, open);
  const [adding, setAdding] = useState(false);
  const region = status?.region ? regionShortNames[status.region] : '';
  const local = tools.local;
  return (
    <section className="st-section" id="settings-tools" aria-labelledby="settings-tools-label">
      <div className="st-section-head">
        <h2 id="settings-tools-label">Tools</h2>
        {tools.supported && (
          <Button
            variant="ghost"
            size="sm"
            className="st-head-action"
            disabled={tools.checking}
            onClick={() => void tools.checkAgain()}
          >
            {tools.checking ? <LoaderCircle className="animate-spin" /> : <RotateCw />}
            {tools.checking ? 'Checking…' : 'Check again'}
          </Button>
        )}
      </div>
      {!tools.supported ? (
        <p className="st-empty">Kalkidan finds your tools in the desktop app.</p>
      ) : !tools.computers ? (
        <p className="st-empty" role="status">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          Checking your tools…
        </p>
      ) : (
        <ul className="st-rows" aria-label={local?.name || 'This computer'}>
          {sortTools(local?.tools).map((tool) => (
            <ToolRow key={tool.tool} tool={tool} />
          ))}
        </ul>
      )}
      <p className="st-foot" id={settingsAnchors.agents}>
        <span className="st-through">
          <img src="./brand/kalkidan-mark.svg" alt="" aria-hidden="true" width="12" height="12" />
          Through Verdictan{region ? ` · ${region}` : ''}
        </span>
        <RestartLine api={api} />
      </p>
      {hosts.map((host) => (
        <HostTools
          key={host.id}
          api={api}
          host={host}
          computer={tools.computers?.find((computer) => computer.computer === host.id)}
          onRemoved={(id) => setHosts((current) => current.filter((item) => item.id !== id))}
        />
      ))}
      {hosts.length > 0 && <SshQuitRow api={api} />}
      {adding ? (
        <AddHostForm
          api={api}
          onCancel={() => setAdding(false)}
          onAdded={(host) => {
            setHosts((current) => [...current.filter((item) => item.id !== host.id), host]);
            setAdding(false);
            void Promise.resolve()
              .then(() => api.remoteConnect(host.id))
              .catch(() => undefined);
          }}
        />
      ) : (
        <button type="button" className="st-add-row" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Add SSH host
        </button>
      )}
      <ProxySignIns api={api} active={open} />
    </section>
  );
}

/** The tools of one SSH host, under its name. The ⋯ menu connects and removes the host. */
function HostTools({
  api,
  host,
  computer,
  onRemoved,
}: {
  api: API;
  host: RemoteHost;
  computer: ComputerTools | undefined;
  onRemoved: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = host.status === 'connected';
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="st-host" id={`computer-${host.id}`}>
      <div className="st-host-head">
        <span className="st-host-name">{host.name}</span>
        {host.target !== host.name && <span className="st-row-meta">{host.target}</span>}
        <span className="st-row-meta st-host-state">
          {busy ? 'Working…' : connected ? '' : 'Not connected'}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton label={`Actions for ${host.name}`} disabled={busy} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {connected ? (
              <DropdownMenuItem onSelect={() => void run(() => api.remoteDisconnect(host.id))}>
                Disconnect
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void run(() => api.remoteConnect(host.id))}>
                Connect
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={menuDestructiveClass} onSelect={() => setConfirm(true)}>
              Remove host…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {computer?.connected && computer.tools.length > 0 && (
        <ul className="st-rows" aria-label={host.name}>
          {sortTools(computer.tools).map((tool) => (
            <ToolRow key={tool.tool} tool={tool} />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Remove ${host.name}?`}
        description="Kalkidan forgets this host. Project folders on the host stay."
        confirmLabel="Remove host"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void run(() => api.remoteRemove(host.id)).then((done) => done && onRemoved(host.id));
        }}
      />
    </div>
  );
}

/**
 * Asks before Kalkidan quits while agent runs or shells work on SSH hosts. "Don't ask again" in
 * the question turns it off. This switch turns it on again. It shows when an SSH host exists.
 */
function SshQuitRow({ api }: { api: API }) {
  const [ask, setAsk] = useState<boolean>();
  useEffect(() => {
    if (typeof api.sshQuitPrompt !== 'function') return;
    void Promise.resolve()
      .then(() => api.sshQuitPrompt!())
      .then(setAsk, () => {});
  }, [api]);
  if (ask === undefined || typeof api.setSshQuitPrompt !== 'function') return null;
  async function choose(next: boolean) {
    const before = ask;
    setAsk(next);
    try {
      setAsk(await api.setSshQuitPrompt!(next));
    } catch {
      setAsk(before);
      showToast({ message: 'Could not save the quit question setting.', tone: 'error' });
    }
  }
  const label = 'Ask before quitting while SSH work runs';
  return (
    <ul className="st-rows">
      <li className="st-row st-setting" id="ssh-quit-prompt">
        <span className="st-row-title">{label}</span>
        <Switch aria-label={label} checked={ask} onCheckedChange={(next) => void choose(next)} />
      </li>
    </ul>
  );
}

/**
 * The proxy sign-ins that Kalkidan saved in the secret store of the system, with Remove. The
 * group shows only when a sign-in is saved. The password never comes to the window.
 */
function ProxySignIns({ api, active }: { api: API; active: boolean }) {
  const [rows, setRows] = useState<{ proxy: string; username: string }[]>([]);
  const [failure, setFailure] = useState('');
  const read = useCallback(() => {
    if (typeof api.proxySignIns !== 'function') return;
    void Promise.resolve()
      .then(() => api.proxySignIns!())
      .then(setRows, () => setRows([]));
  }, [api]);
  useEffect(() => {
    if (active) read();
  }, [active, read]);
  if (!rows.length) return null;
  return (
    <section className="st-host" aria-label="Proxy sign-in">
      <div className="st-host-head">
        <span className="st-host-name">Proxy sign-in</span>
      </div>
      <ul className="st-rows">
        {rows.map((row) => (
          <li key={row.proxy} className="st-row">
            <span className="st-row-title">{row.proxy}</span>
            <span className="st-row-meta">
              {row.username} · Saved in the secret store of this computer
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Remove the proxy sign-in for ${row.proxy}`}
              onClick={() => {
                setFailure('');
                void Promise.resolve()
                  .then(() => api.proxySignInRemove?.(row.proxy))
                  .then(read)
                  .catch((error) => setFailure(errorMessage(error)));
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {failure && (
        <p role="alert" className="field-error">
          {failure}
        </p>
      )}
    </section>
  );
}

/** One line for the first-run tools check: the detail of the tool, ending with the gateway. */
export function checkDetail(tool: ToolStatus) {
  const detail = toolDetail(tool);
  if (tool.kind !== 'agent' || tool.state !== 'ready') return detail.replace(/ · S/, ' · s');
  return [
    detail.replace(/ · S/, ' · s'),
    tool.access === 'granted' ? 'access granted' : '',
    'through Verdictan',
  ]
    .filter(Boolean)
    .join(' · ');
}
