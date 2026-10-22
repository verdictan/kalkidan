import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastInput {
  message: string;
  /** Error toasts stay until the user closes them. Other toasts close after `duration` ms. */
  tone?: 'default' | 'error';
  actions?: ToastAction[];
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
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
 * Shows a toast in the bottom-right corner of the window, two at most. Success toasts close
 * after 4 s (8 s with actions); error toasts stay. Returns a function that closes it.
 */
export function showToast(input: ToastInput | string): () => void {
  const toast: ToastItem = {
    id: nextId++,
    ...(typeof input === 'string' ? { message: input } : input),
  };
  for (const old of items.slice(0, -1)) closeToast(old.id);
  items = [...items, toast];
  emit();
  const close = () => closeToast(toast.id);
  if (toast.tone !== 'error') {
    timers.set(toast.id, { left: toast.duration ?? (toast.actions ? 8000 : 4000), started: 0 });
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

/** Mount one Toaster in the app shell. */
export function Toaster({ className }: { className?: string }) {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  const close = closeToast;
  return (
    <div
      className={cn(
        // Above the dialogs (z-50), so a toast with Undo stays usable while a dialog shows.
        'pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(420px,calc(100vw-2rem))] flex-col items-end gap-2',
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
            'pointer-events-auto flex max-w-full min-h-10 items-center gap-2 rounded-lg border bg-popover py-1.5 pr-1.5 pl-3 text-sm text-popover-foreground shadow-md',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-[var(--motion-base)]',
            item.tone === 'error' && 'text-destructive',
          )}
        >
          <span className="min-w-0 flex-1">{item.message}</span>
          {item.actions?.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant="ghost"
              onClick={() => {
                action.onClick();
                close(item.id);
              }}
            >
              {action.label}
            </Button>
          ))}
          <Button
            size="icon-xs"
            variant="ghost"
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
