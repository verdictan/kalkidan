import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

test('preview windows enforce navigation, bounds, device, selection and download limits', async () => {
  const views: any[] = [],
    calls: any[] = [];
  let canceled = false,
    printSuccess = true,
    selection: any = null,
    destroyed = false;
  const record =
    (name: string) =>
    (...args: any[]) =>
      calls.push([name, ...args]);
  class View {
    visible = false;
    bounds = { x: 0, y: 0, width: 800, height: 600 };
    webContents = Object.assign(new EventEmitter(), {
      session: {},
      isDestroyed: () => false,
      loadURL: async (url: string) => {
        this.url = url;
      },
      getURL: () => this.url,
      getTitle: () => 'Title',
      isLoading: () => false,
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => true,
        goBack: record('back'),
        goForward: record('forward'),
      },
      getZoomFactor: () => 1,
      setZoomFactor: record('zoom'),
      findInPage: record('find'),
      stopFindInPage: record('stopFind'),
      enableDeviceEmulation: record('device'),
      disableDeviceEmulation: record('disableDevice'),
      setWindowOpenHandler: (fn: Function) => {
        this.popup = fn;
      },
      print: (_opts: any, cb: Function) => cb(printSuccess, ''),
      capturePage: async () => ({ toPNG: () => Buffer.from('png') }),
      reload: record('reload'),
      focus: record('focus'),
      close: record('close'),
      executeJavaScriptInIsolatedWorld: async () => selection,
    });
    url = '';
    popup!: Function;
    constructor(public options: any) {
      views.push(this);
    }
    setVisible(value: boolean) {
      this.visible = value;
    }
    setBounds(value: any) {
      this.bounds = value;
    }
    getBounds() {
      return this.bounds;
    }
  }
  const parent = {
    contentView: { addChildView: record('add'), removeChildView: record('remove') },
    getContentSize: () => [1000, 800],
    isDestroyed: () => destroyed,
    webContents: { focus: record('parentFocus') },
  };
  const profile = {
    configure: record('configure'),
    visit: record('visit'),
    summary: () => ({ history: [] }),
    action: async () => 'profile-action',
  };
  const { AnnotationBrowser, previewURL } = backendLoader({
    electron: {
      WebContentsView: View,
      dialog: { showSaveDialog: async () => ({ canceled, filePath: '/fixture/screenshot' }) },
    },
    'node:fs/promises': { writeFile: async (...args: any[]) => calls.push(['write', ...args]) },
  })(resolve('electron/annotation-browser.ts'));
  for (const url of ['file:///private', 'https://user:pass@example.test'])
    assert.throws(() => previewURL(url), /http/);
  const browser = new AnnotationBrowser(() => parent, profile);
  assert.throws(() => browser.state('missing'), /Open a browser/);
  await assert.rejects(browser.open('https://example.test', 'x'.repeat(101)), /Invalid browser/);
  await browser.open('https://example.test');
  await browser.open('https://example.test/new');
  assert.equal(views.length, 1);
  await browser.open('https://other.test', 'other');
  const view = views[0];
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  browser.layout('missing', null);
  browser.layout('default', null);
  assert.equal(view.visible, false);
  assert.throws(() => browser.layout('default', { x: NaN, y: 0, width: 1, height: 1 }), /bounds/);
  browser.layout('default', { x: 1001, y: 0, width: 1, height: 1 });
  assert.equal(view.visible, false);
  browser.layout('default', { x: -1, y: 2.2, width: 1200, height: 1000 });
  assert.deepEqual(view.bounds, { x: 0, y: 2, width: 1000, height: 798 });
  assert.equal(view.visible, true);
  assert.equal(views[1].visible, false);
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  for (const key of ['f', 'l', 't', 'w'])
    view.webContents.emit('before-input-event', event, { control: true, type: 'keyDown', key });
  view.webContents.emit('before-input-event', event, { type: 'keyUp', key: 'x' });
  view.webContents.emit('did-stop-loading');
  view.webContents.emit('found-in-page', {}, { matches: 2, activeMatchOrdinal: 1 });
  for (const name of ['will-navigate', 'will-redirect']) {
    view.webContents.emit(name, event, 'file:///bad');
    view.webContents.emit(name, event, 'https://good.test');
  }
  view.webContents.emit('will-frame-navigate', {
    url: 'file:///bad',
    preventDefault: event.preventDefault,
  });
  view.webContents.emit('will-frame-navigate', { url: 'https://good.test' });
  assert.equal(prevented, 7);
  view.popup({ url: 'file:///bad' });
  for (let i = 0; i < 10; i++) view.popup({ url: 'https://example.test/' + i });
  const state = browser.state('default');
  assert.equal(state.command, 'w');
  assert.equal(state.pendingURLs.length, 8);
  assert.equal(state.find.matches, 2);
  assert.deepEqual(browser.state('default').pendingURLs, []);
  assert.deepEqual(await browser.action('missing', 'profile', null), { history: [] });
  await assert.rejects(browser.action('default', 'find', {}), /shorter search/);
  await browser.action('default', 'find', { text: 'word' });
  await browser.action('default', 'find', { text: 'word', forward: false, next: true });
  await browser.action('default', 'find', { text: '' });
  await assert.rejects(browser.action('default', 'zoom', 4), /Zoom/);
  await browser.action('default', 'zoom', 1.5);
  await assert.rejects(browser.action('default', 'device', { width: 1, height: 2 }), /Device/);
  await browser.action('default', 'device', { width: 400, height: 700 });
  browser.layout('default', { x: 0, y: 0, width: 300, height: 400 });
  await browser.action('default', 'device', null);
  await browser.action('default', 'print', null);
  printSuccess = false;
  await assert.rejects(browser.action('default', 'print', null), /cancelled/);
  canceled = true;
  assert.equal(await browser.action('default', 'screenshot', null), null);
  canceled = false;
  assert.equal(await browser.action('default', 'screenshot', null), 'Screenshot saved');
  assert.equal(await browser.action('default', 'settings', {}), 'profile-action');
  for (const action of ['back', 'forward', 'reload', 'unknown'])
    browser.navigate('default', action);
  assert.equal(await browser.select(), null);
  selection = { selector: 'div', text: 'Text' };
  assert.deepEqual(await browser.select(), {
    ...selection,
    browserId: 'default',
    navigationGeneration: browser.state('default').navigationGeneration,
  });
  selection = { selector: 2 };
  await assert.rejects(browser.select(), /Could not read/);
  let finish!: Function;
  selection = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = browser.select();
  await assert.rejects(browser.select(), /already active/);
  finish(null);
  await pending;
  selection = new Promise((resolve) => {
    finish = resolve;
  });
  const beforeNavigation = browser.select();
  const previousGeneration = browser.state('default').navigationGeneration;
  view.webContents.emit('did-start-navigation', { isMainFrame: false });
  assert.equal(browser.state('default').navigationGeneration, previousGeneration);
  view.webContents.emit('did-start-navigation', { isMainFrame: true });
  finish({ selector: 'old-page', text: 'Old selection' });
  assert.equal(await beforeNavigation, null);
  destroyed = true;
  selection = null;
  await browser.select();
  browser.close('other');
  destroyed = false;
  for (let i = 0; i < 7; i++) await browser.open('https://example.test', 'view-' + i);
  await assert.rejects(browser.open('https://example.test', 'overflow'), /Close an existing/);
  browser.closeAll();
  browser.close();
  assert.throws(() => browser.state('default'), /Open a browser/);
});

test('annotation selection handles hover, selectors, cancellation, timeout and cleanup without a browser', async () => {
  const listeners = new Map<string, Function>();
  const elements: any[] = [];
  let timer!: Function;
  class Element {
    style = {};
    textContent: string | null = 'text';
    id = '';
    tagName = 'DIV';
    parentElement: any = null;
    children: any[] = [];
    removed = false;
    getBoundingClientRect() {
      return { x: 1, y: 2, width: 30, height: 40 };
    }
    remove() {
      this.removed = true;
    }
  }
  const globals = {
    Element,
    document: {
      title: 'Title',
      createElement: () => {
        const el = new Element();
        elements.push(el);
        return el;
      },
      documentElement: { append() {} },
    },
    window: {
      addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    CSS: { escape: (s: string) => s },
    location: { href: 'https://example.test' },
    innerWidth: 1000,
    innerHeight: 800,
    setTimeout: (fn: Function) => {
      timer = fn;
      return 1;
    },
    clearTimeout: () => {},
  };
  const { selectElement } = backendLoader(
    { electron: {} },
    globals,
  )(resolve('electron/annotation-browser.ts'));
  let pending = selectElement();
  listeners.get('mousemove')!({ target: {} });
  const el = new Element();
  listeners.get('mousemove')!({ target: el });
  assert.equal((elements[0].style as any).left, '1px');
  listeners.get('click')!({ target: {}, preventDefault() {}, stopImmediatePropagation() {} });
  const parent = new Element(),
    sibling = new Element();
  parent.id = 'root';
  parent.children = [sibling, el];
  el.parentElement = parent;
  listeners.get('click')!({ target: el, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal((await pending).selector, '#root > div:nth-of-type(2)');
  assert.equal(listeners.size, 0);
  assert.ok(elements.every((el) => el.removed));
  pending = selectElement();
  listeners.get('keydown')!({ key: 'Enter' });
  listeners.get('keydown')!({ key: 'Escape', preventDefault() {} });
  assert.equal(await pending, null);
  pending = selectElement();
  timer();
  assert.equal(await pending, null);
  pending = selectElement();
  const leaf = new Element();
  leaf.textContent = null;
  listeners.get('click')!({ target: leaf, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal((await pending).text, '');
});
