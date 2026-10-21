import { useState, type ReactNode } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Button } from './ui/button';
import { showToast } from './ui/toast';
import { cn } from '../lib/utils';

/** A closed section with a 32px title row, for details that most users do not need. */
export function SettingsDisclosure({
  title,
  children,
  className,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('grid', className)}>
      <CollapsibleTrigger className="-mx-2 flex h-8 items-center gap-2 justify-self-start rounded-md px-2 text-[13px] leading-5 font-semibold outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:shadow-[var(--focus-ring)] [&[data-state=open]>svg]:rotate-90">
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)]"
          aria-hidden="true"
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One group in a Settings tab: a heading row with optional actions, then the content. The
 * group can get focus, so a link to its `id` moves the focus to it.
 */
export function SettingsGroup({
  id,
  title,
  label,
  actions,
  className,
  children,
}: {
  id?: string;
  title: ReactNode;
  /** The name of the region. The default is the title. */
  label?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-label={label || (typeof title === 'string' ? title : undefined)}
      className={cn('settings-group outline-none', className)}
    >
      <div className="settings-group-header">
        <h3 className="settings-group-title">{title}</h3>
        {actions && <div className="settings-group-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Copies a value and confirms it with a toast. */
export function copyValue(value: string, name: string) {
  void Promise.resolve()
    .then(() => navigator.clipboard.writeText(value))
    .then(() => showToast(`${name} copied`))
    .catch(() =>
      showToast({ message: `Could not copy the ${name.toLowerCase()}.`, tone: 'error' }),
    );
}

/** A value in mono text with a Copy button, for IDs and digests in a Details section. */
export function CopyValue({ value, name }: { value: string; name: string }) {
  return (
    <span className="flex min-w-0 items-start gap-1">
      <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">{value}</code>
      <Button
        variant="ghost"
        size="icon-2xs"
        aria-label={`Copy ${name.toLowerCase()}`}
        onClick={() => copyValue(value, name)}
      >
        <Copy />
      </Button>
    </span>
  );
}
