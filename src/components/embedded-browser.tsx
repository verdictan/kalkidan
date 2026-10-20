import { BrowserMenu } from './browser-menu';
import { Choice } from './choice';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MousePointer2, RefreshCw, X } from 'lucide-react';
import type { API, BrowserSelection, BrowserState } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Hint } from './hint';
import { AttachHint } from './diff-review';
import { hasPrimaryModifier, shortcutLabel } from '../lib/platform';
import { errorMessage } from '../lib/errors';
export function EmbeddedBrowser({
  api,
  visible,
  remote,
  disabled,
  disabledReason = '',
  onAttach,
  initialURL,
  onTitle,
  onNewTab,
  onClose,
}: {
  initialURL?: string;
  onTitle: (title: string) => void;
  onNewTab: (url?: string) => void;
  onClose: () => void;
  api: API;
  visible: boolean;
  remote: boolean;
  disabled: boolean;
  /** Why "Attach annotation" is disabled. */
  disabledReason?: string;
  onAttach: (selection: BrowserSelection, comment: string) => void;
}) {
  const address = useRef<HTMLInputElement>(null);
  const [id] = useState(() => crypto.randomUUID());
  const callbacks = useRef({ onTitle, onNewTab, onClose });
  callbacks.current = { onTitle, onNewTab, onClose };
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [preset, setPreset] = useState('');
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 390, height: 844 });
  const viewport = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(initialURL || 'http://localhost:3000');
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<BrowserState>();
  const [selection, setSelection] = useState<BrowserSelection | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const editingURL = useRef(false);
  const toolbar = useRef<HTMLFormElement>(null);
  // The element that had focus before the find bar opened.
  const findReturn = useRef<HTMLElement | null>(null);
  const lastURL = useRef('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void api.browserClose(id).catch(() => {});
    };
  }, [api, id]);
  useEffect(() => {
    if (!ready) return;
    let previous = '',
      cancelled = false;
    const sync = () => {
      const el = viewport.current;
      const r = el?.getBoundingClientRect();
      const obscured = document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      );
      const bounds =
        visible &&
        !selection &&
        el &&
        !el.closest('[hidden]') &&
        !obscured &&
        r &&
        r.width > 0 &&
        r.height > 0
          ? { x: r.x, y: r.y, width: r.width, height: r.height }
          : null;
      const next = JSON.stringify(bounds);
      if (next !== previous) {
        previous = next;
        void api.browserLayout(id, bounds).catch(() => {});
      }
    };
    sync();
    const timer = setInterval(sync, 100);
    const changes = new MutationObserver(sync);
    changes.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-state', 'style'],
    });
    const update = async () => {
      try {
        const value = await api.browserState(id);
        if (!cancelled) {
          setState(value);
          if (value.command === 'f') openFind();
          if (value.command === 'l') address.current?.select();
          if (value.command === 't') callbacks.current.onNewTab();
          if (value.command === 'w') callbacks.current.onClose();
          callbacks.current.onTitle(value.title || new URL(value.url).hostname);
          value.pendingURLs?.forEach((url) => callbacks.current.onNewTab(url));
          if (value.url !== lastURL.current && !editingURL.current) {
            setUrl(value.url);
            lastURL.current = value.url;
          }
        }
      } catch {}
    };
    void update();
    const status = setInterval(() => void update(), 700);
    return () => {
      cancelled = true;
      changes.disconnect();
      clearInterval(timer);
      clearInterval(status);
      void api.browserLayout(id, null).catch(() => {});
    };
  }, [api, id, ready, visible, selection]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function navigate(target: string) {
    await action(async () => {
      setSelection(null);
      await api.browserOpen(target, id);
      if (!alive.current) {
        await api.browserClose(id);
        return;
      }
      setReady(true);
    });
  }
  useEffect(() => {
    if (initialURL) void navigate(initialURL);
    else if (api.browserAction)
      void api
        .browserAction(id, 'profile')
        .then((profile) => {
          if (alive.current && profile?.settings?.home) setUrl(profile.settings.home);
        })
        .catch((e) => {
          if (alive.current) setError('Could not load the browser home page: ' + errorMessage(e));
        });
  }, []);
  useEffect(() => {
    if (!visible) return;
    const listener = (e: KeyboardEvent) => {
      if (hasPrimaryModifier(e) && !e.altKey && !e.shiftKey && e.code === 'KeyF' && ready) {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [visible, ready]);
  async function find(text: string, next = false, forward = true) {
    await action(() => api.browserAction(id, 'find', { text, next, forward }));
  }
  function openFind() {
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body && !findOpen)
      findReturn.current = current;
    setFindOpen(true);
  }
  // Close the find bar and move focus back to where it was. If that element is
  // gone (for example, a menu item), move focus to the browser menu button.
  function closeFind() {
    setFindOpen(false);
    void find('');
    const target = findReturn.current;
    findReturn.current = null;
    requestAnimationFrame(() => {
      if (target?.isConnected && !target.closest('[hidden]')) target.focus();
      else toolbar.current?.querySelector<HTMLElement>('[aria-label="Browser menu"]')?.focus();
    });
  }
  // The go button shows only while the address differs from the open page. Enter also opens it.
  const urlEdited = !ready || url.trim() !== (state?.url || lastURL.current);
  const statusText = busy
    ? 'Working…'
    : state?.url ||
      (remote
        ? 'Chromium in Kalkidan · use a reachable URL or SSH-forwarded port'
        : 'Embedded Chromium · isolated from your desktop bridge');
  return (
    <div className="browser-pane" hidden={!visible}>
      <form
        ref={toolbar}
        className="tool-toolbar browser-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate(url);
        }}
      >
        <Hint label="Back">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Back"
            disabled={!state?.canGoBack || busy}
            onClick={() => void action(() => api.browserNavigate(id, 'back'))}
          >
            <ArrowLeft />
          </Button>
        </Hint>
        <Hint label="Forward">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Forward"
            disabled={!state?.canGoForward || busy}
            onClick={() => void action(() => api.browserNavigate(id, 'forward'))}
          >
            <ArrowRight />
          </Button>
        </Hint>
        <Hint label="Reload preview">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Reload preview"
            disabled={!ready || busy}
            onClick={() => void action(() => api.browserNavigate(id, 'reload'))}
          >
            <RefreshCw className={state?.loading ? 'animate-spin' : ''} />
          </Button>
        </Hint>
        <Input
          ref={address}
          variant="filled"
          aria-label="Preview URL"
          className="h-7 w-20 min-w-0 flex-1 text-xs"
          value={url}
          onFocus={() => {
            editingURL.current = true;
          }}
          onBlur={() => {
            editingURL.current = false;
          }}
          onChange={(e) => setUrl(e.target.value)}
        />
        {urlEdited && (
          <Hint label="Open preview (Enter)">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Open preview"
              aria-keyshortcuts="Enter"
              disabled={busy || !url.trim()}
            >
              <ArrowRight />
            </Button>
          </Hint>
        )}
        <Hint label="Select element to annotate">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Select element"
            disabled={busy || !ready}
            onClick={() =>
              void action(async () => {
                const result = await api.browserSelect(id);
                if (result) setSelection(result);
              })
            }
          >
            <MousePointer2 />
          </Button>
        </Hint>
        <BrowserMenu
          api={api}
          id={id}
          ready={ready}
          url={state?.url || url}
          zoom={state?.zoom || 1}
          findShortcut={shortcutLabel(['mod'], 'F')}
          onFind={openFind}
          onDevice={() => setDeviceOpen((value) => !value)}
          onNavigate={(target) => {
            setUrl(target);
            void navigate(target);
          }}
          onError={setError}
        />
      </form>
      {findOpen && (
        <form
          className="tool-toolbar browser-find"
          onSubmit={(e) => {
            e.preventDefault();
            void find(findText, true);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            closeFind();
          }}
        >
          <Input
            autoFocus
            variant="filled"
            aria-label="Find in page"
            aria-keyshortcuts="Enter"
            placeholder="Find in page…"
            className="h-7 w-20 min-w-0 flex-1 text-xs"
            value={findText}
            onChange={(e) => {
              setFindText(e.target.value);
              void find(e.target.value);
            }}
          />
          <span className="text-muted-foreground tabular-nums">
            {state?.find?.activeMatchOrdinal || 0}/{state?.find?.matches || 0}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous match"
            onClick={() => void find(findText, true, false)}
          >
            <ArrowLeft />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next match">
            <ArrowRight />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Close find"
            onClick={closeFind}
          >
            <X />
          </Button>
        </form>
      )}
      {deviceOpen && (
        <div className="tool-toolbar browser-device">
          <Choice
            size="sm"
            className="w-28 text-xs"
            label="Device preset"
            value={preset}
            onChange={(value) => {
              setPreset(value);
              if (!value) {
                void action(() => api.browserAction(id, 'device', null));
                return;
              }
              const [width, height] = value.split('x').map(Number);
              setDimensions({ width, height });
              void action(() => api.browserAction(id, 'device', { width, height }));
            }}
            options={[
              { value: '', label: 'Responsive' },
              { value: '390x844', label: 'Phone' },
              { value: '768x1024', label: 'Tablet' },
              { value: '1440x900', label: 'Desktop' },
            ]}
          />
          <Input
            aria-label="Device width"
            className="h-7 w-16 px-1 text-xs"
            type="number"
            min={240}
            max={3840}
            value={dimensions.width}
            onChange={(e) => setDimensions((d) => ({ ...d, width: Number(e.target.value) }))}
          />
          <span>×</span>
          <Input
            aria-label="Device height"
            className="h-7 w-16 px-1 text-xs"
            type="number"
            min={240}
            max={3840}
            value={dimensions.height}
            onChange={(e) => setDimensions((d) => ({ ...d, height: Number(e.target.value) }))}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void action(() => api.browserAction(id, 'device', dimensions))}
          >
            Apply
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close device toolbar"
            onClick={() => {
              setDeviceOpen(false);
              void action(() => api.browserAction(id, 'device', null));
            }}
          >
            <X />
          </Button>
        </div>
      )}
      {selection ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <div className="flex justify-between gap-2">
            <code className="truncate text-xs">{selection.selector}</code>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel annotation"
              onClick={() => setSelection(null)}
            >
              <X />
            </Button>
          </div>
          <Textarea
            aria-label="Browser annotation"
            placeholder="Describe the change…"
            rows={2}
            maxLength={10000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <AttachHint reason={disabledReason}>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || !comment.trim()}
              onClick={() => {
                onAttach(selection, comment);
                setSelection(null);
                setComment('');
              }}
            >
              Attach annotation
            </Button>
          </AttachHint>
        </div>
      ) : (
        <div ref={viewport} className="browser-viewport" aria-label="Embedded browser">
          {!ready && (
            <p className="px-4 text-center break-all">
              {url.trim() ? `Press Enter to open ${url.trim()}.` : 'Type a URL to preview it here.'}
            </p>
          )}
        </div>
      )}
      <div className="tool-statusbar" title={statusText}>
        {statusText}
      </div>
      {error && (
        <p role="alert" className="field-error max-h-16 shrink-0 overflow-auto px-3 py-1">
          {error}
        </p>
      )}
    </div>
  );
}
