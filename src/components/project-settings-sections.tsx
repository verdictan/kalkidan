import { useEffect, useId, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { Folder, FolderGit2, FolderPlus, GitBranch } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost } from '../types';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import { worktreeParent } from '../lib/worktree-sessions';
import { errorMessage } from '../lib/errors';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { showToast } from './ui/toast';
import { DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

const colorName = (value: ProjectColor | null) =>
  value ? value[0].toUpperCase() + value.slice(1) : 'Default';

export type SettingsSection<T extends string> = { value: T; label: string; icon: ReactNode };

/**
 * The frame of Project settings and Board settings: a list of sections on the left and one
 * section on the right. The dialog has a fixed height, so it does not move when the section
 * changes. Each panel mounts the first time that it opens and then stays mounted.
 */
export function SettingsDialogFrame<T extends string>({
  title,
  description,
  sections,
  value,
  onValueChange,
  panels,
  actions,
  onOpenAutoFocus,
}: {
  title: string;
  /** Text for assistive technology. The frame does not show it. */
  description: string;
  sections: SettingsSection<T>[];
  value: T;
  onValueChange(value: T): void;
  panels: Partial<Record<T, ReactNode>>;
  /** Controls in the section header, to the left of the close button. */
  actions?: ReactNode;
  onOpenAutoFocus?(event: Event): void;
}) {
  const [visited, setVisited] = useState<T[]>([value]);
  useEffect(() => {
    setVisited((current) => (current.includes(value) ? current : [...current, value]));
  }, [value]);
  const active = sections.find((item) => item.value === value) || sections[0];
  return (
    <DialogContent
      size="lg"
      // A fixed height, so that the dialog does not move when the section changes.
      className="project-settings-dialog flex h-[min(616px,calc(100dvh-4rem))] gap-0 overflow-hidden p-0"
      onOpenAutoFocus={onOpenAutoFocus}
    >
      <TabsPrimitive.Root
        value={active?.value}
        onValueChange={(next) => onValueChange(next as T)}
        orientation="vertical"
        className="flex min-h-0 min-w-0 flex-1"
      >
        <nav className="project-settings-nav">
          <DialogTitle className="project-settings-nav-title text-xs leading-4 font-semibold text-muted-foreground">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <TabsPrimitive.List aria-label={`${title} sections`} className="grid gap-px">
            {sections.map((item) => (
              <TabsPrimitive.Trigger
                key={item.value}
                value={item.value}
                className="project-settings-nav-item"
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </TabsPrimitive.Trigger>
            ))}
          </TabsPrimitive.List>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="project-settings-header">
            <h3>{active?.label}</h3>
            {actions}
          </header>
          <div className="project-settings-body">
            {sections.map(
              (item) =>
                (visited.includes(item.value) || item.value === active?.value) && (
                  <TabsPrimitive.Content
                    key={item.value}
                    forceMount
                    value={item.value}
                    className="outline-none data-[state=inactive]:hidden"
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

/** A group of "Label — control" rows with dividers. */
export function SettingsRows({
  label,
  className,
  children,
}: {
  /** The name of the group for assistive technology. With it, the group is a region. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className={cn('project-settings-rows', className)}>
      {children}
    </section>
  );
}

/** One row: a label with one line of help on the left, and the control on the right. */
export function SettingsRow({
  label,
  help,
  icon,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  icon?: ReactNode;
  /** The id of the field that the label names. */
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div className={cn('project-settings-row', className)}>
      {icon && (
        <span className="project-settings-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="project-settings-row-label">
        <Label {...(htmlFor ? { htmlFor } : {})} className="project-settings-row-name">
          {label}
        </Label>
        {help && <div className="project-settings-row-help">{help}</div>}
      </div>
      {children && <div className="project-settings-row-control">{children}</div>}
    </div>
  );
}

/**
 * The name and color of a project, where its work runs, and the removal of the project. The
 * color saves at once with Undo. The name saves when you press Enter or leave the field.
 */
export function ProjectGeneral({
  api,
  group,
  host,
  onSaved,
  onRemove,
}: {
  api: API;
  group: ProjectGroup;
  host?: RemoteHost;
  onSaved(): void | Promise<void>;
  /** Starts the removal of the project. Without it, the Remove project row does not show. */
  onRemove?(): void;
}) {
  const nameId = useId();
  const [name, setName] = useState(group.name);
  const [savedName, setSavedName] = useState(group.name);
  const [color, setColor] = useState<ProjectColor | null>(group.color || null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  // Take the values again when the project changes from somewhere else.
  useEffect(() => {
    setName(group.name);
    setSavedName(group.name);
  }, [group.name]);
  useEffect(() => setColor(group.color || null), [group.color]);
  async function saveName() {
    const next = name.trim();
    if (!next) {
      setName(savedName);
      return;
    }
    if (next === savedName || state === 'saving') return;
    setState('saving');
    setError('');
    try {
      await api.updateGroup(group.id, next);
      setSavedName(next);
      setName(next);
      setState('saved');
      await onSaved();
    } catch (failure) {
      setState('idle');
      setError(errorMessage(failure));
    }
  }
  async function changeColor(next: ProjectColor | null) {
    const previous = color;
    if (next === previous) return;
    setColor(next);
    setError('');
    try {
      await api.setGroupColor(group.id, next);
      await onSaved();
      showToast({
        message: `Folder color changed to ${colorName(next).toLowerCase()}.`,
        actions: [
          {
            label: 'Undo',
            onClick: () => {
              setColor(previous);
              void api
                .setGroupColor(group.id, previous)
                .then(onSaved)
                .catch((failure) => setError(errorMessage(failure)));
            },
          },
        ],
      });
    } catch (failure) {
      setColor(previous);
      setError(errorMessage(failure));
    }
  }
  const location = group.hostId
    ? [host?.name || 'SSH host', host?.target, group.rootPath].filter(Boolean).join(' · ')
    : ['This computer', group.rootPath].filter(Boolean).join(' · ');
  return (
    <div id="project-general-form" className="grid gap-6">
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <SettingsRows>
        <SettingsRow
          label="Project name"
          htmlFor={nameId}
          help={
            <span role="status">
              {state === 'saving'
                ? 'Saving…'
                : state === 'saved'
                  ? 'Saved'
                  : name.trim() !== savedName
                    ? 'Press Enter to save.'
                    : 'Shows in the sidebar and the header.'}
            </span>
          }
        >
          <Input
            id={nameId}
            className="w-56"
            value={name}
            maxLength={150}
            placeholder="e.g. Customer platform"
            onChange={(event) => {
              setName(event.target.value);
              if (state === 'saved') setState('idle');
            }}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void saveName();
            }}
          />
        </SettingsRow>
        <SettingsRow label="Folder color" help="Shows in the sidebar.">
          <div role="group" aria-label="Folder color" className="project-settings-colors">
            {([null, ...Object.keys(projectColors)] as (ProjectColor | null)[]).map((value) => (
              <Button
                key={value || 'default'}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${colorName(value)} folder`}
                aria-pressed={color === value}
                title={colorName(value)}
                onClick={() => void changeColor(value)}
                style={{ color: value ? projectColors[value] : 'var(--muted-foreground)' }}
              >
                <Folder />
              </Button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Runs on"
          help={
            group.hostId && !group.rootPath
              ? 'The project folder is set when the project opens on its host.'
              : 'To use a different computer, create a new project there.'
          }
        >
          <span className="project-settings-value" title={location}>
            {location}
          </span>
        </SettingsRow>
      </SettingsRows>
      {onRemove && (
        <SettingsRows label="Remove project" className="project-settings-danger">
          <SettingsRow
            label="Remove project"
            help={`Kalkidan stops showing ${group.name}. All files stay on disk.`}
          >
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              Remove project…
            </Button>
          </SettingsRow>
        </SettingsRows>
      )}
    </div>
  );
}

/** The code folders of a project: the list, Add a code folder and Remove. */
export function ProjectCodeFolders({
  group,
  repos,
  onAdd,
  onRemove,
}: {
  group: ProjectGroup;
  /** All code folders. The section shows the code folders of this project. */
  repos: Project[];
  onAdd(): void;
  onRemove(repo: Project): void;
}) {
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  if (!members.length)
    return (
      <section aria-label="Code folders">
        <EmptyState
          icon={<FolderGit2 />}
          title="No code folders"
          action={
            <Button onClick={onAdd}>
              <FolderPlus />
              Add a code folder…
            </Button>
          }
        >
          Agents read and change the files in the code folders of a project.
        </EmptyState>
      </section>
    );
  return (
    <section aria-label="Code folders" className="grid gap-3">
      <div className="flex items-center gap-4">
        <p className="project-settings-row-help m-0 flex-1">
          Agents read and change the files in these folders. When you remove a folder, its files and
          chats stay on disk.
        </p>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <FolderPlus />
          Add a code folder…
        </Button>
      </div>
      <ul className="project-settings-rows m-0 list-none p-0">
        {members.map((repo) => {
          const copy = !!worktreeParent(repo, members);
          return (
            <li key={repo.id}>
              <SettingsRow
                icon={copy ? <FolderGit2 /> : <GitBranch />}
                label={repo.name}
                help={
                  <span className="block truncate" title={repo.path}>
                    {copy ? 'Branch copy · ' : ''}
                    {repo.path}
                  </span>
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Remove ${repo.name} from this project`}
                  onClick={() => onRemove(repo)}
                >
                  Remove…
                </Button>
              </SettingsRow>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
