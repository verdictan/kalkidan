// The browser preview has no window buttons. The splash then draws their place, as the app
// does, so the window keeps the same look. The desktop app gives `window.workspace` before
// this script runs.
if (!window.workspace) document.getElementById('splash')?.classList.add('splash-preview');
