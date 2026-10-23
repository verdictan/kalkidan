import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastInput {
  message: string;
  /**
   * Error toasts show an alert icon and stay until the user closes them. Success toasts show a
   * check.
   */
  tone?: 'default' | 'success' | 'error';
  /** A toast with actions stays until the user uses or closes it, or the page changes. */
  actions?: ToastAction[];
  /** Closes the toast after this many ms. Default: 4 s without actions. */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
  shown: number;
}

// Timers pause while the pointer or the focus is on a toast.
const timers = new Map<
  number,
  { left: number; started: number; handle?: ReturnType<typeof setTimeout> }
>();
function startTimer(id: number) {
  const timer = timers.get(id);
  if (!timer || timer.handle) return;
  timer.started = Date.now();
  timer.handle = setTimeout(() => closeToast(id), timer.left);
}
function pauseTimer(id: number) {
  const timer = timers.get(id);
  if (!timer?.handle) return;
  clearTimeout(timer.handle);
  timer.handle = undefined;
  timer.left = Math.max(1500, timer.left - (Date.now() - timer.started));
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(next: ToastItem[]) => void>();
const emit = () => listeners.forEach((listener) => listener(items));

/**
 * Shows a toast in the bottom-right corner of the window, two at most. A toast closes after
 * 4 s. A toast with actions and an error toast stay until the user closes them. Every toast
 * closes when the page changes (Toaster `resetKey`). Returns a function that closes it.
 */
export function showToast(input: ToastInput | string): () => void {
  const toast: ToastItem = {
    id: nextId++,
    shown: Date.now(),
    ...(typeof input === 'string' ? { message: input } : input),
  };
  for (const old of items.slice(0, -1)) closeToast(old.id);
  items = [...items, toast];
  emit();
  const close = () => closeToast(toast.id);
  const duration = toast.duration ?? (toast.tone === 'error' || toast.actions ? 0 : 4000);
  if (duration > 0) {
    timers.set(toast.id, { left: duration, started: 0 });
    startTimer(toast.id);
  }
  return close;
}

function closeToast(id: number) {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
  items = items.filter((item) => item.id !== id);
  emit();
}

export function dismissToasts() {
  for (const timer of timers.values()) if (timer.handle) clearTimeout(timer.handle);
  timers.clear();
  items = [];
  emit();
}

/**
 * Mount one Toaster in the app shell. When `resetKey` changes (the page), the toasts of the
 * previous page close. A toast from the last second stays: the action that changed the page
 * showed it.
 */
export function Toaster({ className, resetKey }: { className?: string; resetKey?: string }) {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    const now = Date.now();
    for (const item of items) if (now - item.shown > 1000) closeToast(item.id);
  }, [resetKey]);
  const close = closeToast;
  return (
    <div
      className={cn(
        // Above the dialogs and menus, so a toast with Undo stays usable while a dialog shows.
        'pointer-events-none fixed right-5 bottom-[calc(1.25rem+var(--toast-offset,0px))] z-[var(--z-toast)] flex w-[min(420px,calc(100vw-2.5rem))] flex-col items-end gap-2',
        className,
      )}
    >
      {/* This live region stays mounted, so screen readers announce each new toast. */}
      <div className="sr-only" aria-live="polite">
        {list
          .filter((item) => item.tone !== 'error')
          .map((item) => item.message.trim().replace(/([^.!?])$/, '$1.'))
          .join(' ')}
      </div>
      {list.map((item) => (
        <div
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          data-slot="toast"
          onPointerEnter={() => pauseTimer(item.id)}
          onPointerLeave={() => startTimer(item.id)}
          onFocus={() => pauseTimer(item.id)}
          onBlur={() => startTimer(item.id)}
          className={cn(
            // One dark toast: 40px, radius 10, 12px text, the actions in bold white.
            'pointer-events-auto flex max-w-full min-h-10 items-center gap-1 rounded-lg bg-foreground py-1.5 pr-2 pl-3.5 text-xs text-background shadow-[var(--shadow-toast)]',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-[var(--motion-base)]',
          )}
        >
          {item.tone === 'error' && (
            <CircleAlert className="mr-1 size-4 shrink-0 text-background" aria-hidden="true" />
          )}
          {item.tone === 'success' && (
            <Check className="mr-1 size-4 shrink-0 text-background/70" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 pr-2">{item.message}</span>
          {item.actions?.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant="ghost"
              className="px-2 text-xs font-semibold text-background hover:bg-background/10 hover:text-background"
              onClick={() => {
                action.onClick();
                close(item.id);
              }}
            >
              {action.label}
            </Button>
          ))}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-background/70 hover:bg-background/10 hover:text-background"
            aria-label="Close notification"
            onClick={() => close(item.id)}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}
