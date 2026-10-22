import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
import { useFirstRunState, useVerdictanStatus } from '../hooks/use-verdictan-status';
import { RuntimeReadiness, SignInSteps, type SignInResult } from './sign-in-steps';

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

/**
 * The full-window first screen: one card to sign in or create a Verdictan account. The shell
 * shows it instead of the workspace (no sidebar).
 *
 * `onDone` receives `signedIn: true` right after the sign-in. The shell then opens the empty
 * workspace at "Open a code folder", with no onboarding dialog. The setup of the agents
 * continues in the background, and the sidebar footer shows its progress. After "Set up later"
 * it receives `signedIn: false`, and the app opens signed out with the SessionBanner.
 */
export function Welcome({ api, onDone }: { api: API; onDone: (result: SignInResult) => void }) {
  async function finish(result: SignInResult) {
    try {
      if (typeof api.setWelcomeDone === 'function') await api.setWelcomeDone();
    } catch {
      /* The Welcome screen shows again at the next launch. Nothing else depends on it. */
    }
    onDone(result);
  }
  return (
    <div className="welcome" data-testid="welcome">
      <header className="welcome-titlebar">
        <RuntimeReadiness api={api} />
      </header>
      <main className="welcome-main">
        <SignInSteps
          api={api}
          mode="window"
          onFinished={(result) => void finish(result)}
          onSkip={() => void finish({ signedIn: false })}
        />
      </main>
    </div>
  );
}
