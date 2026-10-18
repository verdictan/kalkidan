export interface BrowserSelection {
  url: string;
  title: string;
  selector: string;
  text: string;
  tag: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}
export interface BrowserProfileData {
  history: { url: string; title: string; at: string }[];
  downloads: {
    id: string;
    name: string;
    path: string;
    state: string;
    received: number;
    total: number;
  }[];
  settings: { home: string; rememberHistory: boolean };
  credentials: { id: string; origin: string; username: string }[];
}
export interface BrowserState {
  command?: string;
  zoom?: number;
  find?: { matches: number; activeMatchOrdinal: number };
  pendingURLs?: string[];
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
