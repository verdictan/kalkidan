import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { SectionHeader } from './ui/page-header';
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
 * The one "Advanced" fold of a Settings section. It holds the developer details: paths,
 * builds, digests, and service addresses. Its rows sit in one box.
 */
export function SettingsAdvanced({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <SettingsDisclosure title="Advanced" defaultOpen={defaultOpen}>
      <div className="settings-advanced-box">{children}</div>
    </SettingsDisclosure>
  );
}

/**
 * One group in a Settings section: a section header with optional actions, then the content.
 * The group can get focus, so a link to its `id` moves the focus to it.
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
      className={cn('settings-group', className)}
    >
      <SectionHeader size="sm" title={title} actions={actions} className="mb-0" />
      {children}
    </section>
  );
}

/** A list of Settings rows with a divider above the first row. */
export function SettingsRows({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cn('settings-rows', className)}>
      {children}
    </ul>
  );
}

/**
 * One Settings row: an optional icon, the label and one line of help, then the control. The
 * row is at least 52px high. `extra` shows under the row, for example an error or a form.
 */
export function SettingsRow({
  id,
  icon,
  label,
  help,
  children,
  extra,
  className,
}: {
  id?: string;
  icon?: ReactNode;
  label: ReactNode;
  help?: ReactNode;
  /** The control: a button, a select, a switch, or a status. */
  children?: ReactNode;
  extra?: ReactNode;
  className?: string;
}) {
  const labelId = useId();
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
          <span id={labelId} className="settings-row-label">
            {label}
          </span>
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
