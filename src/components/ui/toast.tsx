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

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(next: ToastItem[]) => void>();
const emit = () => listeners.forEach((listener) => listener(items));

/** Shows a toast at the bottom centre of the window. Returns a function that closes it. */
export function showToast(input: ToastInput | string): () => void {
  const toast: ToastItem = {
    id: nextId++,
    ...(typeof input === 'string' ? { message: input } : input),
  };
  items = [...items.slice(-2), toast];
  emit();
  const close = () => closeToast(toast.id);
  if (toast.tone !== 'error') setTimeout(close, toast.duration ?? (toast.actions ? 8000 : 4000));
  return close;
}

function closeToast(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function dismissToasts() {
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
        'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4',
        className,
      )}
    >
      {/* This live region stays mounted, so screen readers announce each new toast. */}
      <div className="sr-only" aria-live="polite">
        {list
          .filter((item) => item.tone !== 'error')
          .map((item) => item.message)
          .join('. ')}
      </div>
      {list.map((item) => (
        <div
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          data-slot="toast"
          className={cn(
            'pointer-events-auto flex max-w-[min(560px,100%)] min-h-10 items-center gap-2 rounded-lg border bg-popover py-1.5 pr-1.5 pl-3 text-sm text-popover-foreground shadow-md',
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
