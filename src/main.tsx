import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import { App } from './app';
import { demo } from './demo';
import { platform } from './lib/platform';
import './styles.css';
const api = window.workspace || demo;
// Lets CSS place the title bar controls for each platform.
document.documentElement.dataset.platform = platform;
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
