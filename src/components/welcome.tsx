import { useEffect, useState, type DragEvent } from 'react';
import { Check } from 'lucide-react';
import type { API, FolderScan } from '../api/contracts';
import { useFirstRunState, useVerdictanStatus } from '../hooks/use-verdictan-status';
import { errorMessage } from '../lib/errors';
import { regionNames } from '../lib/region-suggestion';
import { accountNames } from '../lib/verdictan-labels';
import { folderName, RepositoryChecklist } from './repository-import';
import { RuntimeReadiness, SignInSteps, type SignInResult } from './sign-in-steps';
import { Button } from './ui/button';

/**
 * True when the shell must show the Welcome screen: the user did not finish or skip it yet,
 * no account ever signed in on this computer, and no account is signed in now. A returning user
 * with an ended session gets the SessionBanner instead. Undefined while Kalkidan reads the state. Always false in the
 * browser preview and in builds without the first-run state.
 */
export function useWelcomeGate(api: API, preview = false) {
  const firstRun = useFirstRunState(api);
  const account = useVerdictanStatus(api, !preview);
  const [decided, setDecided] = useState<boolean>();
  useEffect(() => {
    // Decide once at launch. A sign-in later does not show the Welcome screen again.
    if (decided !== undefined) return;
    if (preview || !firstRun.supported || !account.supported) return setDecided(false);
    if (!firstRun.state || !account.status) return;
    setDecided(
      !firstRun.state.welcomeDone &&
        !firstRun.state.everSignedIn &&
        account.status.phase !== 'authenticated',
    );
  }, [decided, preview, firstRun.supported, firstRun.state, account.supported, account.status]);
  return {
    show: decided,
    /** Call after Welcome finishes. */
    hide: () => setDecided(false),
  };
}

/** A shorter folder path for one line: the home folder becomes "~". */
export function shortPath(path: string) {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~');
}

/** "3 Git repositories", or "No Git repositories" for a folder without one. */
function repositoryCount(count: number) {
  return count
    ? `${count} Git ${count === 1 ? 'repository' : 'repositories'}`
    : 'No Git repositories';
}

/** The path of a dropped folder. The desktop gives it; the browser preview does not. */
type DropApi = API & { pathForFile?: (file: File) => string | undefined };

/**
 * The first run in one card, with two steps. 1: sign in to Verdictan (or "Later"). 2: choose or
 * drop a folder. The card lists the Git repositories in it, all checked, and "Start in <name>"
 * makes the project with them and opens it on the composer. There is no Get started dialog and
 * no question about the repositories. The shell shows the card in place of the workspace.
 *
 * `onDone` receives the result: `signedIn`, and `groupId` when the card made a project.
 */
export function Welcome({ api, onDone }: { api: API; onDone: (result: SignInResult) => void }) {
  const account = useVerdictanStatus(api);
  const status = account.status;
  const signedIn = status?.phase === 'authenticated';
  // Step 1 ends when the sign-in finishes (with the setup of the organization) or on "Later".
  const [finished, setFinished] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const signInDone = finished || skipped;
  const [scan, setScan] = useState<FolderScan>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'' | 'scan' | 'create'>('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const canChoose = typeof api.chooseFolder === 'function';
  async function finish(result: SignInResult) {
    try {
      if (typeof api.setWelcomeDone === 'function') await api.setWelcomeDone();
    } catch {
      /* The Welcome card shows again at the next launch. Nothing else depends on it. */
    }
    onDone(result);
  }
  async function scanPath(path: string) {
    setBusy('scan');
    setError('');
    try {
      const result =
        typeof api.scanRepositories === 'function'
          ? await api.scanRepositories(path)
          : { root: path, rootIsRepository: false, repositories: [] };
      setScan(result);
      setSelected(new Set(result.repositories.filter((r) => !r.added).map((r) => r.path)));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }
  async function chooseFolder() {
    if (!canChoose) return;
    const path = await api.chooseFolder('Choose a code folder', 'Choose');
    if (path) await scanPath(path);
  }
  /** Makes the project with the checked repositories, then opens it. */
  async function start() {
    if (!scan || busy) return;
    const paths = scan.repositories.length ? [...selected] : [scan.root];
    if (!paths.length) return;
    setBusy('create');
    setError('');
    const key = `kalkidan-onboarding-create:${scan.root}`;
    try {
      let operationId = '';
      try {
        operationId = localStorage.getItem(key) || crypto.randomUUID();
        localStorage.setItem(key, operationId);
      } catch {
        operationId = crypto.randomUUID();
      }
      const groupId = await api.createGroup(
        folderName(scan.root),
        '',
        undefined,
        'github',
        undefined,
        operationId,
        paths,
      );
      try {
        localStorage.removeItem(key);
      } catch {
        /* The next try makes a new project. */
      }
      await finish({ signedIn, groupId });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy('');
    }
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (!signInDone || busy) return;
    const file = event.dataTransfer.files[0];
    const path = file && (api as DropApi).pathForFile?.(file);
    if (path) void scanPath(path);
  }
  const name = scan ? folderName(scan.root) : '';
  const available = scan ? scan.repositories.filter((r) => !r.added) : [];
  const names = accountNames(status);
  const region = status?.region ? regionNames[status.region] : '';
  return (
    <div className="welcome" data-testid="welcome">
      <header className="welcome-titlebar">
        <RuntimeReadiness api={api} />
      </header>
      <main className="welcome-main">
        <section
          className="welcome-card"
          aria-label="Welcome to Kalkidan"
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            if (!signInDone) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <h1 className="welcome-brand">
            <img src="./brand/kalkidan-mark.svg" alt="" aria-hidden="true" width="32" height="32" />
            Kalkidan
          </h1>
          <ol className="welcome-steps">
            <li className="welcome-step" data-state={signInDone ? 'done' : 'current'}>
              <StepMark number={1} done={finished || (skipped && signedIn)} />
              <div className="welcome-step-body">
                {signInDone ? (
                  <>
                    <p className="welcome-step-title">
                      {signedIn ? names.user || names.email || 'Signed in' : 'Not signed in'}
                    </p>
                    <p className="welcome-step-help">
                      {signedIn ? (
                        [names.organization, region].filter(Boolean).join(' · ')
                      ) : (
                        <Button
                          variant="link"
                          className="text-foreground underline"
                          onClick={() => setSkipped(false)}
                        >
                          Sign in
                        </Button>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="welcome-step-title">Sign in</p>
                    <SignInSteps
                      api={api}
                      mode="step"
                      onFinished={(result) => {
                        if (result.signedIn) setFinished(true);
                        else setSkipped(true);
                      }}
                      onSkip={() => setSkipped(true)}
                    />
                  </>
                )}
              </div>
            </li>
            <li
              className="welcome-step"
              data-state={signInDone ? 'current' : 'next'}
              aria-disabled={!signInDone || undefined}
            >
              <StepMark number={2} />
              <div className="welcome-step-body">
                <p className="welcome-step-title">{scan ? name : 'Choose a code folder'}</p>
                {scan && (
                  <p className="welcome-step-help" title={scan.root}>
                    {shortPath(scan.root)} · {repositoryCount(available.length)}
                  </p>
                )}
                {signInDone && scan && (
                  <RepositoryChecklist
                    scan={scan}
                    selected={selected}
                    onChange={setSelected}
                    disabled={!!busy}
                    className="welcome-repositories"
                  />
                )}
                {signInDone && (
                  <div className="welcome-actions">
                    {scan ? (
                      <>
                        <Button
                          size="lg"
                          disabled={!!busy || (!!scan.repositories.length && !selected.size)}
                          onClick={() => void start()}
                        >
                          {busy === 'create' ? 'Starting…' : `Start in ${name}`}
                        </Button>
                        <Button
                          size="lg"
                          variant="ghost"
                          disabled={!!busy || !canChoose}
                          onClick={() => void chooseFolder()}
                        >
                          Other folder…
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="lg"
                          disabled={!!busy || !canChoose}
                          onClick={() => void chooseFolder()}
                        >
                          {busy === 'scan' ? 'Looking for repositories…' : 'Choose folder…'}
                        </Button>
                        <Button
                          size="lg"
                          variant="ghost"
                          disabled={!!busy}
                          onClick={() => void finish({ signedIn })}
                        >
                          Later
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {error && (
                  <p role="alert" className="field-error">
                    {error}
                  </p>
                )}
              </div>
            </li>
          </ol>
        </section>
      </main>
    </div>
  );
}

/** The mark of a step: a number, or a green check when it is done. */
function StepMark({ number, done = false }: { number: number; done?: boolean }) {
  return (
    <span className="welcome-step-mark" data-done={done || undefined} aria-hidden="true">
      {done ? <Check /> : number}
    </span>
  );
}
