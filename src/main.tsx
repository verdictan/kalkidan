import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import { App } from './app';
import { demo } from './demo';
import './styles.css';
const api = window.workspace || demo;
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={350}>
      <App api={api} preview={!window.workspace} />
    </TooltipProvider>
  </React.StrictMode>,
);
