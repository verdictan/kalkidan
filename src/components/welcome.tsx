import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, CircleAlert } from 'lucide-react';
import type { API } from '../api/contracts';
import { toolDetail, toolsNeedAttention, type ToolStatus } from '../domain/desktop';
import { useFirstRunState } from '../hooks/use-verdictan-status';
import { hideSplash } from '../lib/splash';
import { ReadyCheck, restartKalkidan, sortTools, useComputerTools } from './settings-tools';
import type { SignInResult } from './sign-in-steps';
import { Button } from './ui/button';

/** The demo keeps its first-run state here. The preview shows the tools check only with it. */
const demoFirstRunKey = 'kalkidan-demo-first-run';

function demoFirstRunSet() {
  try {
    return localStorage.getItem(demoFirstRunKey) !== null;
  } catch {
    return false;
  }
}

/**
 * True when the shell must show the tools check ("Almost ready") before the composer: this is
 * the first run, and a tool is missing, not signed in, or has no access. With every tool found,
 * the first run ends here and the check never shows. Undefined while Kalkidan reads the state.
 * The browser preview shows it only when the demo first-run state is set.
 */
export function useWelcomeGate(api: API, preview = false) {
  const firstRun = useFirstRunState(api);
  const allowed = !preview || demoFirstRunSet();
  const firstTime =
    allowed && firstRun.supported && !!firstRun.state && !firstRun.state.welcomeDone;
  const tools = useComputerTools(api, firstTime);
  const [decided, setDecided] = useState<boolean>();
  useEffect(() => {
    // Decide once at launch. A tool that the user installs later does not show the check again.
    if (decided !== undefined) return;
    if (!allowed || !firstRun.supported) return setDecided(false);
    if (!firstRun.state) return;
    if (firstRun.state.welcomeDone || firstRun.state.everSignedIn) return setDecided(false);
    if (!tools.supported) return setDecided(false);
    if (!tools.computers) return;
    const show = toolsNeedAttention(tools.local);
    if (!show && typeof api.setWelcomeDone === 'function')
      void Promise.resolve()
        .then(() => api.setWelcomeDone())
        .catch(() => undefined);
    setDecided(show);
  }, [decided, allowed, firstRun.supported, firstRun.state, tools.supported, tools.computers]);
  return {
    show: decided,
    /** Call after the tools check finishes. */
    hide: () => setDecided(false),
  };
}

/** A shorter folder path for one line: the home folder becomes "~". */
export function shortPath(path: string) {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~');
}

/**
 * The short name of an official page: the host, for example "docs.anthropic.com". A page on
 * github.com also shows its path, for example "github.com/openai/codex".
 */
function pageHost(url: string) {
  try {
    const page = new URL(url);
    return page.host === 'github.com' ? page.host + page.pathname.replace(/\/$/, '') : page.host;
  } catch {
    return url;
  }
}

/** The order of the tools check rows, as on the agreed frame: Claude Code, Codex, GitHub CLI. */
function checkOrder(tools: ToolStatus[] | undefined) {
  const rank = (tool: ToolStatus) =>
    tool.tool === 'claude' ? 0 : tool.tool === 'codex' ? 1 : tool.kind === 'agent' ? 2 : 3;
  return [...(tools || [])].sort((a, b) => rank(a) - rank(b));
}

/**
 * One tool on the tools check: the name, one line of detail and, at the right, "Ready" or a link
 * to its official page ("Get Codex ↗" when it is not installed, else "Install guide ↗").
 */
function CheckRow({ tool }: { tool: ToolStatus }) {
  const ready = tool.state === 'ready';
  return (
    <li className="st-check-row" data-state={tool.state}>
      <span className="st-check-text">
        <span className="st-check-name">{tool.name}</span>
        <span className="st-check-detail">{toolDetail(tool)}</span>
      </span>
      {ready ? (
        <span className="st-check-ready">
          <ReadyCheck label="Ready" />
          Ready
        </span>
      ) : (
        <a
          className="st-link st-check-link"
          href={tool.installUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${tool.name}: ${pageHost(tool.installUrl)} (opens in the browser)`}
        >
          <CircleAlert className="sr-only" role="img" aria-label="Needs you" />
          {tool.installed ? 'Install guide' : `Get ${tool.name}`}
          <ArrowUpRight aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

/**
 * The first-run tools check (SP-C5). It shows only when a tool is missing: the Kalkidan lockup,
 * "Your tools" and one row for Claude Code, Codex and the GitHub CLI, each with its state and,
 * when it is not ready, a link to its official page. Kalkidan does not install or set up these
 * tools. "Continue" opens the composer with the first agent found. With no agent found, the one
 * action is "Restart Kalkidan". The sign-in comes later, at the first send.
 *
 * `onDone` receives `{ signedIn: false }`.
 */
export function Welcome({ api, onDone }: { api: API; onDone: (result: SignInResult) => void }) {
  const tools = useComputerTools(api);
  const lockup = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => checkOrder(tools.local?.tools), [tools.local]);
  const agent = sortTools(list).find((tool) => tool.kind === 'agent' && tool.usable);
  // The launch splash lockup glides into this lockup (SP-C5).
  useLayoutEffect(() => {
    if (!lockup.current) return;
    hideSplash({ glideTo: lockup.current });
  }, []);
  async function finish() {
    setBusy(true);
    try {
      if (typeof api.setWelcomeDone === 'function') await api.setWelcomeDone();
    } catch {
      /* The tools check shows again at the next launch. Nothing else depends on it. */
    }
    onDone({ signedIn: false });
  }
  return (
    <div className="welcome st-first-run" data-testid="welcome">
      <header className="welcome-titlebar" />
      <main className="st-first-run-main">
        <div className="st-first-run-column">
          <div ref={lockup} id="first-run-lockup" className="st-first-run-lockup">
            <img src="./brand/kalkidan-mark.svg" alt="" aria-hidden="true" width="32" height="32" />
            <span>Kalkidan</span>
          </div>
          <h1 id="first-run-tools" className="st-first-run-heading">
            Your tools
          </h1>
          <ul
            className="st-check-list"
            aria-labelledby="first-run-tools"
            aria-busy={!tools.computers}
          >
            {list.map((tool) => (
              <CheckRow key={tool.tool} tool={tool} />
            ))}
          </ul>
          <p className="st-restart st-check-restart">
            Installed something? Restart Kalkidan to find it.
          </p>
          <div className="st-check-actions">
            {agent ? (
              <>
                <Button
                  className="st-check-continue"
                  disabled={busy}
                  aria-label={`Continue with ${agent.name}`}
                  onClick={() => void finish()}
                >
                  Continue
                </Button>
                <Button
                  variant="secondary"
                  className="bg-background px-[13px] shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[var(--fill)]"
                  disabled={busy}
                  onClick={() => restartKalkidan(api)}
                >
                  Restart Kalkidan
                </Button>
              </>
            ) : (
              <Button disabled={busy || !tools.computers} onClick={() => restartKalkidan(api)}>
                Restart Kalkidan
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
