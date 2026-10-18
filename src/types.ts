// Compatibility barrel. New modules can import their domain or capability directly.
export * from './domain/github';
export * from './domain/conversation';
export * from './domain/project';
export * from './domain/browser';
export * from './domain/terminal';
export * from './domain/tracker';
export * from './api/contracts';
import type { API } from './api/contracts';
declare global {
  interface Window {
    workspace?: API;
  }
}
