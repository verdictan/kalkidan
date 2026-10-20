import { writeFile } from 'node:fs/promises';
import type { BrowserProfile } from './browser-profile';
import { BrowserWindow, WebContentsView, dialog } from 'electron';
import type { BrowserSelection, BrowserBounds } from '../src/types';

export function previewURL(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an http or https URL without embedded credentials.');
  return url.href;
}
// Runs in a separate JavaScript world: the page receives no desktop bridge.
export function selectElement() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483647',
      border: '2px solid #6366f1',
      background: '#6366f11a',
    });
    document.documentElement.append(overlay);
    const banner = document.createElement('div');
    banner.textContent = 'Select an element to annotate · Esc to cancel';
    Object.assign(banner.style, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      pointerEvents: 'none',
      padding: '10px 16px',
      background: '#18181b',
      color: 'white',
      borderRadius: '8px',
      font: '13px system-ui',
    });
    document.documentElement.append(banner);
    const move = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const r = event.target.getBoundingClientRect();
      Object.assign(overlay.style, {
        left: r.x + 'px',
        top: r.y + 'px',
        width: r.width + 'px',
        height: r.height + 'px',
      });
    };
    const finish = (result: unknown) => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
      overlay.remove();
      banner.remove();
      resolve(result);
    };
    const click = (event: MouseEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const el = event.target;
      if (!(el instanceof Element)) return;
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && parts.length < 8) {
        if (node.id) {
          parts.unshift('#' + CSS.escape(node.id));
          break;
        }
        const tag = node.tagName.toLowerCase();
        const siblings = node.parentElement
          ? [...node.parentElement.children].filter((n) => n.tagName === node!.tagName)
          : [];
        parts.unshift(
          tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''),
        );
        node = node.parentElement;
      }
      const r = el.getBoundingClientRect();
      finish({
        url: location.href,
        title: document.title.slice(0, 300),
        selector: parts.join(' > '),
        text: (el.textContent || '').slice(0, 3000),
        tag: el.tagName.toLowerCase(),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        viewport: { width: innerWidth, height: innerHeight },
      });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    };
    const timer = setTimeout(() => finish(null), 60000);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
  });
}
export class AnnotationBrowser {
  private views = new Map<string, WebContentsView>();
  private commands = new Map<string, string>();
  private pendingURLs = new Map<string, string[]>();
  private findResults = new Map<string, { matches: number; activeMatchOrdinal: number }>();
  private devices = new Map<string, { width: number; height: number }>();
  private selecting = new Set<string>();
  constructor(
    private parent: () => BrowserWindow,
    private profile: BrowserProfile,
  ) {}
  private get(id: string) {
    const view = this.views.get(id);
    if (!view || view.webContents.isDestroyed()) throw new Error('Open a browser preview first.');
    return view;
  }
  async open(value: string, id = 'default') {
    const url = previewURL(value);
    if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid browser ID');
    let view = this.views.get(id);
    if (!view || view.webContents.isDestroyed()) {
      if (this.views.size >= 8)
        throw new Error('Close an existing preview before opening another.');
      view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: 'persist:kalkidan-preview',
        },
      });
      this.views.set(id, view);
      this.parent().contentView.addChildView(view);
      view.setVisible(false);
      const wc = view.webContents;
      this.profile.configure(wc.session);
      wc.on('before-input-event', (event, input) => {
        if (
          (input.meta || input.control) &&
          input.type === 'keyDown' &&
          ['f', 'l', 't', 'w'].includes(input.key.toLowerCase())
        ) {
          event.preventDefault();
          this.commands.set(id, input.key.toLowerCase());
        }
      });
      wc.on('did-stop-loading', () => this.profile.visit(wc.getURL(), wc.getTitle()));
      wc.on('found-in-page', (_event, result) =>
        this.findResults.set(id, {
          matches: result.matches,
          activeMatchOrdinal: result.activeMatchOrdinal,
        }),
      );
      wc.setWindowOpenHandler(({ url }) => {
        try {
          const next = previewURL(url);
          this.pendingURLs.set(id, [...(this.pendingURLs.get(id) || []), next].slice(-8));
        } catch {}
        return { action: 'deny' };
      });
      const guard = (event: Electron.Event, target: string) => {
        try {
          previewURL(target);
        } catch {
          event.preventDefault();
        }
      };
      wc.on('will-navigate', guard);
      wc.on('will-redirect', guard);
      wc.on('will-frame-navigate', (event) => {
        try {
          previewURL(event.url);
        } catch {
          event.preventDefault();
        }
      });
    }
    await view.webContents.loadURL(url);
  }
  layout(id: string, bounds: BrowserBounds | null) {
    const view = this.views.get(id);
    if (!view || view.webContents.isDestroyed()) return;
    if (!bounds) {
      view.setVisible(false);
      return;
    }
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite))
      throw new Error('Invalid browser bounds');
    const [width, height] = this.parent().getContentSize();
    const x = Math.max(0, Math.round(bounds.x)),
      y = Math.max(0, Math.round(bounds.y));
    const w = Math.min(Math.round(bounds.width), width - x),
      h = Math.min(Math.round(bounds.height), height - y);
    if (w < 1 || h < 1) {
      view.setVisible(false);
      return;
    }
    for (const [key, other] of this.views) if (key !== id) other.setVisible(false);
    view.setBounds({ x, y, width: w, height: h });
    view.setVisible(true);
    this.applyDevice(id);
  }
  state(id: string) {
    const wc = this.get(id).webContents;
    const pendingURLs = this.pendingURLs.get(id) || [];
    this.pendingURLs.delete(id);
    const command = this.commands.get(id);
    this.commands.delete(id);
    return {
      command,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoom: wc.getZoomFactor(),
      find: this.findResults.get(id),
      pendingURLs,
    };
  }
  private applyDevice(id: string) {
    const device = this.devices.get(id);
    if (!device) return;
    const view = this.get(id),
      bounds = view.getBounds();
    view.webContents.enableDeviceEmulation({
      screenPosition: 'mobile',
      screenSize: device,
      deviceScaleFactor: 1,
      viewPosition: { x: 0, y: 0 },
      viewSize: device,
      scale: Math.min(bounds.width / device.width, bounds.height / device.height, 1),
    });
  }
  async action(id: string, action: string, value: any) {
    if (action === 'profile') return this.profile.summary();
    const wc = this.get(id).webContents;
    if (action === 'find') {
      if (typeof value?.text !== 'string' || value.text.length > 1000)
        throw new Error('Enter a shorter search.');
      if (value.text)
        wc.findInPage(value.text, {
          forward: value.forward !== false,
          findNext: value.next !== true,
        });
      else {
        wc.stopFindInPage('clearSelection');
        this.findResults.delete(id);
      }
      return;
    }
    if (action === 'zoom') {
      if (!Number.isFinite(value) || value < 0.25 || value > 3)
        throw new Error('Zoom must be between 25% and 300%.');
      wc.setZoomFactor(value);
      return;
    }
    if (action === 'device') {
      if (value === null) {
        this.devices.delete(id);
        wc.disableDeviceEmulation();
        return;
      }
      if (![value?.width, value?.height].every((n) => Number.isInteger(n) && n >= 240 && n <= 3840))
        throw new Error('Device dimensions must be 240–3840 pixels.');
      this.devices.set(id, { width: value.width, height: value.height });
      this.applyDevice(id);
      return;
    }
    if (action === 'print')
      return new Promise<void>((resolve, reject) =>
        wc.print({ silent: false, printBackground: true }, (success, reason) =>
          success ? resolve() : reject(new Error(reason || 'Printing cancelled.')),
        ),
      );
    if (action === 'screenshot') {
      const image = await wc.capturePage();
      const result = await dialog.showSaveDialog(this.parent(), {
        title: 'Save browser screenshot',
        defaultPath: 'browser-screenshot.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, image.toPNG());
      return 'Screenshot saved';
    }
    return this.profile.action(wc, action, value);
  }

  navigate(id: string, action: string) {
    const wc = this.get(id).webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward())
      wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
  }
  async select(id = 'default'): Promise<BrowserSelection | null> {
    const view = this.get(id);
    if (this.selecting.has(id)) throw new Error('An element selection is already active.');
    this.selecting.add(id);
    view.webContents.focus();
    try {
      const result = await view.webContents.executeJavaScriptInIsolatedWorld(999, [
        { code: `(${selectElement.toString()})()` },
      ]);
      if (!this.parent().isDestroyed()) this.parent().webContents.focus();
      if (!result) return null;
      if (
        typeof result.selector !== 'string' ||
        typeof result.text !== 'string' ||
        JSON.stringify(result).length > 12000
      )
        throw new Error('Could not read the selected element.');
      return result;
    } finally {
      this.selecting.delete(id);
    }
  }
  close(id = 'default') {
    const view = this.views.get(id);
    if (!view) return;
    if (!this.parent().isDestroyed()) this.parent().contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.views.delete(id);
    this.pendingURLs.delete(id);
    this.findResults.delete(id);
    this.devices.delete(id);
  }
  closeAll() {
    for (const id of this.views.keys()) this.close(id);
  }
}
