// The launch splash is static markup in index.html, so it shows before any script loads.
// The app hides it when the first page can show. It waits only for the entrance of the
// lockup, never for a minimum time.

/** The end of the entrance: the name is in place at 760 ms after the launch. */
const entranceMs = 760;
/** The hand-off: the lockup fades in 200 ms, the background 40 ms later. */
const outMs = 240;
/** The first-run glide of the lockup into the tools check heading. */
const glideMs = 320;
/** The reduced-motion cross-fade. */
const fadeMs = 150;
/** The splash never stays longer than this, also when the app cannot load. */
const maximumMs = 8000;

let hidden = false;

export interface HideSplashOptions {
  /**
   * First run: the element that the lockup becomes, for example the lockup of the tools check
   * heading. The lockup glides to its box, then the splash goes. The element is hidden while
   * the lockup moves, so the two do not show together.
   */
  glideTo?: HTMLElement | null;
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Moves the lockup onto the target box. Returns false when the target has no box. */
function glide(splash: HTMLElement, target: HTMLElement) {
  const lockup = splash.querySelector<HTMLElement>('.splash-lockup');
  const mark = splash.querySelector<SVGElement>('.splash-mark');
  if (!lockup || !mark) return false;
  const to = target.getBoundingClientRect();
  if (!to.width || !to.height) return false;
  // Measure the mark and the lockup before it aligns to the left.
  const before = mark.getBoundingClientRect();
  splash.classList.add('splash-glide');
  const from = mark.getBoundingClientRect();
  const scale = to.height / from.height;
  // The lockup scales from its left edge. Align the mark first, then move it to the target.
  const box = lockup.getBoundingClientRect();
  lockup.style.transition = 'none';
  lockup.style.transform = `translate(${before.left - from.left}px, 0)`;
  void lockup.offsetWidth;
  lockup.style.transition = '';
  const x = to.left - box.left;
  const y = to.top + to.height / 2 - (box.top + box.height / 2);
  lockup.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  return true;
}

/**
 * Hides the splash and removes it. Later calls do nothing. Without a target, the lockup lifts
 * 6 px and fades with the background. With `glideTo`, the lockup glides into that element.
 */
export function hideSplash(options: HideSplashOptions = {}) {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById('splash');
  if (!splash) return;
  // Browser automation (tests) does not wait for the splash.
  const fast = navigator.webdriver;
  const reduced = reducedMotion();
  window.setTimeout(
    () => {
      const target = !fast && !reduced ? options.glideTo : null;
      if (target && target.isConnected) {
        const visibility = target.style.visibility;
        target.style.visibility = 'hidden';
        if (glide(splash, target)) {
          window.setTimeout(() => {
            target.style.visibility = visibility;
            splash.remove();
          }, glideMs);
          return;
        }
        target.style.visibility = visibility;
      }
      splash.classList.add('splash-out');
      window.setTimeout(() => splash.remove(), fast ? 0 : reduced ? fadeMs : outMs);
    },
    fast || reduced ? 0 : Math.max(0, entranceMs - performance.now()),
  );
}

if (typeof window !== 'undefined') window.setTimeout(() => hideSplash(), maximumMs);
