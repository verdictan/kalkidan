import { BrowserMenu } from './browser-menu';
import { Choice } from './choice';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MousePointer2, RefreshCw, X } from 'lucide-react';
import type { API, BrowserSelection, BrowserState } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
export function EmbeddedBrowser({
  api,
  visible,
  remote,
  disabled,
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
          if (value.command === 'f') setFindOpen(true);
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
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
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
        .catch(() => {});
  }, []);
  useEffect(() => {
    if (!visible) return;
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && ready) {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [visible, ready]);
  async function find(text: string, next = false, forward = true) {
    await action(() => api.browserAction(id, 'find', { text, next, forward }));
  }
  return (
    <div className="browser-pane" hidden={!visible}>
      <form
        className="flex shrink-0 items-center gap-1 border-b p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate(url);
        }}
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Back"
          disabled={!state?.canGoBack || busy}
          onClick={() => void action(() => api.browserNavigate(id, 'back'))}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Forward"
          disabled={!state?.canGoForward || busy}
          onClick={() => void action(() => api.browserNavigate(id, 'forward'))}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Reload preview"
          disabled={!ready || busy}
          onClick={() => void action(() => api.browserNavigate(id, 'reload'))}
        >
          <RefreshCw size={14} className={state?.loading ? 'animate-spin' : ''} />
        </Button>
        <Input
          ref={address}
          aria-label="Preview URL"
          className="h-8 min-w-0 text-xs"
          value={url}
          onFocus={() => {
            editingURL.current = true;
          }}
          onBlur={() => {
            editingURL.current = false;
          }}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open preview"
          title="Go"
          disabled={busy || !url.trim()}
        >
          <ArrowRight size={14} />
        </Button>
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
          <MousePointer2 size={15} />
        </Button>
        <BrowserMenu
          api={api}
          id={id}
          ready={ready}
          url={state?.url || url}
          zoom={state?.zoom || 1}
          onFind={() => setFindOpen(true)}
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
          className="browser-find"
          onSubmit={(e) => {
            e.preventDefault();
            void find(findText, true);
          }}
        >
          <Input
            autoFocus
            aria-label="Find in page"
            placeholder="Find in page…"
            value={findText}
            onChange={(e) => {
              setFindText(e.target.value);
              void find(e.target.value);
            }}
          />
          <span className="text-xs text-muted-foreground">
            {state?.find?.activeMatchOrdinal || 0}/{state?.find?.matches || 0}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous match"
            onClick={() => void find(findText, true, false)}
          >
            <ArrowLeft size={14} />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next match">
            <ArrowRight size={14} />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Close find"
            onClick={() => {
              setFindOpen(false);
              void find('');
            }}
          >
            <X size={14} />
          </Button>
        </form>
      )}
      {deviceOpen && (
        <div className="browser-device">
          <Choice
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
            type="number"
            min={240}
            max={3840}
            value={dimensions.width}
            onChange={(e) => setDimensions((d) => ({ ...d, width: Number(e.target.value) }))}
          />
          <span>×</span>
          <Input
            aria-label="Device height"
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
            <X size={14} />
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
              <X size={14} />
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
        </div>
      ) : (
        <div ref={viewport} className="browser-viewport" aria-label="Embedded browser">
          {!ready && <p>Open a URL to preview it here.</p>}
        </div>
      )}
      <div className="shrink-0 truncate border-t px-3 py-1 text-[11px] text-muted-foreground">
        {busy
          ? 'Working…'
          : state?.url ||
            (remote
              ? 'Chromium on this Mac · use a reachable URL or SSH-forwarded port'
              : 'Embedded Chromium · isolated from your desktop bridge')}
      </div>
      {error && (
        <p
          role="alert"
          className="max-h-16 shrink-0 overflow-auto px-3 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
