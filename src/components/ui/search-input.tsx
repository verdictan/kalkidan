import { useRef, useState, type ComponentProps } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';

/** Sets the value of a React-controlled input and fires its change handler. */
function clearInput(input: HTMLInputElement) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

/**
 * A search field with a 14px icon. sm 28px for filter bars, md 32px elsewhere. Every search
 * field uses the filled style with 13px text. When the field has text, a 20px ghost X clears
 * it. The native clear button is hidden.
 */
export function SearchInput({
  className,
  size = 'md',
  variant = 'filled',
  onInput,
  ...props
}: Omit<ComponentProps<typeof Input>, 'size'> & { size?: 'sm' | 'md' }) {
  const ref = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(Boolean(props.defaultValue));
  const hasValue = props.value !== undefined ? String(props.value).length > 0 : typed;
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={ref}
        type="search"
        variant={variant}
        size={size}
        className={cn(
          'pl-7 text-sm [&::-webkit-search-cancel-button]:appearance-none',
          hasValue && 'pr-7',
        )}
        onInput={(event) => {
          setTyped(event.currentTarget.value.length > 0);
          onInput?.(event);
        }}
        {...props}
      />
      {hasValue && !props.disabled && (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-1 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:shadow-[var(--focus-ring-inset)] focus-visible:outline-none"
          onClick={() => ref.current && clearInput(ref.current)}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
