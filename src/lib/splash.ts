// The launch splash is static markup in index.html, so it shows before any script loads.
// The app hides it when the first page can show. It never waits for its own animation.

/** The shortest time the splash shows, so the brackets can close and it does not only flash. */
const minimumMs = 900;
/** The length of the fade out. It matches the transition of `#splash` in index.html. */
const fadeMs = 200;
/** The splash never stays longer than this, also when the app cannot load. */
const maximumMs = 8000;

let hidden = false;

/** Fades the splash out and removes it. Later calls do nothing. */
export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById('splash');
  if (!splash) return;
  // Browser automation (tests) does not wait for the splash.
  const fast = navigator.webdriver;
  window.setTimeout(
    () => {
      splash.classList.add('splash-out');
      window.setTimeout(() => splash.remove(), fast ? 0 : fadeMs);
    },
    fast ? 0 : Math.max(0, minimumMs - performance.now()),
  );
}

if (typeof window !== 'undefined') window.setTimeout(hideSplash, maximumMs);
