import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import { App } from './app';
import { demo } from './demo';
import { platform } from './lib/platform';
import { applyAppearance, readAppearance, schemeFromSearch } from './lib/appearance';
import './styles.css';
// A "?scheme=dark" or "?scheme=light" query sets the first paint, before the saved
// appearance loads. Tests and screenshots use it.
const scheme = schemeFromSearch();
if (scheme) document.documentElement.classList.toggle('dark', scheme === 'dark');
const api = window.workspace || demo;
// Lets CSS place the title bar controls for each platform.
document.documentElement.dataset.platform = platform;
// Apply the saved light, dark or system appearance.
const appearance = readAppearance();
void window.workspace?.setAppearance?.(appearance);
// The query wins over "system", so the first paint and the page agree.
applyAppearance(scheme && appearance === 'system' ? scheme : appearance);
window.workspace?.onFullScreenChange?.((fullScreen) => {
  document.documentElement.dataset.fullscreen = String(fullScreen);
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={350}>
      <App api={api} preview={!window.workspace} />
    </TooltipProvider>
  </React.StrictMode>,
);
