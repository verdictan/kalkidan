import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { ChevronRight, Copy } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Badge } from './ui/badge';
import { StatusDot } from './ui/status-dot';
import { Button } from './ui/button';
import { DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { showToast } from './ui/toast';
import { cn } from '../lib/utils';
import type { StatusLabel } from '../lib/verdictan-labels';

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
      <CollapsibleTrigger className="-mx-2 flex h-8 items-center gap-2 justify-self-start rounded-md px-2 text-xs leading-4 font-semibold text-muted-foreground outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:shadow-[var(--focus-ring)] [&[data-state=open]>svg]:rotate-90">
        <ChevronRight
          className="size-4 shrink-0 transition-transform duration-[var(--motion-fast)]"
          aria-hidden="true"
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A list of Settings rows with dividers between the rows. With `title`, a group label shows
 * above the rows and names the list.
 */
export function SettingsRows({
  label,
  title,
  children,
  className,
}: {
  /** The name of the list for assistive technology. */
  label?: string;
  /** A visible group label above the rows, for example "Danger zone". */
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const list = (
    <ul
      aria-label={title ? undefined : label}
      aria-labelledby={title ? id : undefined}
      className={cn('settings-rows', !title && className)}
    >
      {children}
    </ul>
  );
  if (!title) return list;
  return (
    <section className={cn('settings-group', className)}>
      <h3 id={id} className="group-label">
        {title}
      </h3>
      {list}
    </section>
  );
}

/**
 * The one Settings row of Preferences, Computers and Project settings: an optional 28px icon,
 * the label (13/500) and one line of help (12), then the control. The row is at least 48px
 * high, with 16px between its parts. `extra` shows under the row, for example an error or a
 * form.
 */
export function SettingsRow({
  id,
  icon,
  label,
  help,
  htmlFor,
  children,
  extra,
  className,
}: {
  id?: string;
  icon?: ReactNode;
  label: ReactNode;
  help?: ReactNode;
  /** The id of the field that the label names. */
  htmlFor?: string;
  /** The control: a button, a select, a switch, or a status. */
  children?: ReactNode;
  extra?: ReactNode;
  className?: string;
}) {
  const labelId = useId();
  const Label = htmlFor ? 'label' : 'span';
  return (
    <>
      <li
        id={id}
        tabIndex={id ? -1 : undefined}
        role="group"
        aria-labelledby={labelId}
        className={cn('settings-row', className)}
      >
        {icon}
        <div className="settings-row-text">
          <Label id={labelId} {...(htmlFor ? { htmlFor } : {})} className="settings-row-label">
            {label}
          </Label>
          {help && <span className="settings-row-help">{help}</span>}
        </div>
        {children && <div className="settings-row-control">{children}</div>}
      </li>
      {extra && (
        <li className="settings-row-extra" data-indent={icon ? '' : undefined}>
          {extra}
        </li>
      )}
    </>
  );
}

export type SettingsSection<T extends string> = {
  value: T;
  label: string;
  icon: ReactNode;
  /** A group label above this item, for example "Projects". */
  group?: string;
  /** A dot after the label: something in the section needs the user. */
  attention?: boolean;
};

/**
 * The one settings shell: a dialog with the sections on the left and one section on the right.
 * Each panel mounts the first time that it opens and then stays mounted. The section title gets
 * the focus when the dialog opens.
 */
export function SettingsShell<T extends string>({
  title,
  hideTitle = false,
  subtitle,
  description,
  navLabel,
  sections,
  value,
  onValueChange,
  panels,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  /** The name of the dialog. The nav shows it above the sections, unless `hideTitle`. */
  title: ReactNode;
  /** The title is for assistive technology only. The nav starts with the first section. */
  hideTitle?: boolean;
  /** One muted line below the title, for example the computer of a remote project. */
  subtitle?: ReactNode;
  /** Text for assistive technology. The shell does not show it. */
  description: string;
  /** The name of the section list for assistive technology. */
  navLabel: string;
  sections: SettingsSection<T>[];
  value: T;
  onValueChange(value: T): void;
  panels: Partial<Record<T, ReactNode>>;
  className?: string;
  /** Without it, the focus goes to the section title. */
  onOpenAutoFocus?(event: Event): void;
  onCloseAutoFocus?(event: Event): void;
}) {
  const [visited, setVisited] = useState<T[]>([value]);
  useEffect(() => {
    setVisited((current) => (current.includes(value) ? current : [...current, value]));
  }, [value]);
  const heading = useRef<HTMLHeadingElement>(null);
  const active = sections.find((item) => item.value === value) || sections[0];
  return (
    <DialogContent
      size="lg"
      // Utilities, so that they replace the grid and the height of DialogContent.
      className={cn(
        'settings-dialog flex max-h-[min(80vh,calc(100dvh-2rem))] min-h-[min(400px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0',
        className,
      )}
      onCloseAutoFocus={onCloseAutoFocus}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        // The title gets the focus, so no focus ring shows on a row or a field.
        event.preventDefault();
        heading.current?.focus();
      }}
    >
      <TabsPrimitive.Root
        value={active?.value}
        onValueChange={(next) => onValueChange(next as T)}
        orientation="vertical"
        className="contents"
      >
        <nav
          className="settings-nav"
          // The tabs move the focus by script, so a click can match :focus-visible. A click
          // shows no ring. A key shows it again.
          onPointerDown={(event) => (event.currentTarget.dataset.pointer = '')}
          onKeyDown={(event) => delete event.currentTarget.dataset.pointer}
        >
          <DialogTitle
            className={cn(
              hideTitle
                ? 'sr-only'
                : 'group-label settings-nav-title truncate py-0 text-2xs leading-4',
            )}
          >
            {title}
          </DialogTitle>
          {subtitle && <p className="settings-nav-subtitle">{subtitle}</p>}
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <TabsPrimitive.List aria-label={navLabel} loop className="contents">
            {sections.map((item, index) => (
              <Fragment key={item.value}>
                {item.group && item.group !== sections[index - 1]?.group && (
                  <p className="group-label settings-nav-group" aria-hidden="true">
                    {item.group}
                  </p>
                )}
                <TabsPrimitive.Trigger
                  value={item.value}
                  className="settings-nav-item"
                  aria-description={item.attention ? 'Needs attention' : undefined}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.attention && <StatusDot tone="warning" size="sm" />}
                </TabsPrimitive.Trigger>
              </Fragment>
            ))}
          </TabsPrimitive.List>
        </nav>
        <div className="settings-main">
          <h2 ref={heading} tabIndex={-1} className="settings-main-title truncate">
            {active?.label}
          </h2>
          <div className="settings-body">
            {sections.map(
              (item) =>
                (visited.includes(item.value) || item.value === active?.value) && (
                  <TabsPrimitive.Content
                    key={item.value}
                    forceMount
                    value={item.value}
                    className="settings-panel data-[state=inactive]:hidden"
                  >
                    {panels[item.value]}
                  </TabsPrimitive.Content>
                ),
            )}
          </div>
        </div>
      </TabsPrimitive.Root>
    </DialogContent>
  );
}

const dotTones = {
  success: 'success',
  warning: 'warning',
  destructive: 'danger',
  secondary: 'neutral',
  muted: 'neutral',
} as const;

/** A status in a Settings row: one dot and a short muted label, for example "● Ready". */
export function StatusText({ status }: { status: StatusLabel }) {
  return (
    <span className="settings-status" data-tone={status.tone} role="status">
      <StatusDot tone={dotTones[status.tone]} size="sm" />
      {status.label}
    </span>
  );
}

/** A status in a Settings row, as a small badge. */
export function StatusBadge({ status }: { status: StatusLabel }) {
  return (
    <Badge variant={status.tone} size="sm" role="status">
      {status.label}
    </Badge>
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

/** A value in mono text with a Copy button, for IDs and digests in an Advanced fold. */
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
