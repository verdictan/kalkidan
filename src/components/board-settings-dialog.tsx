import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Columns3,
  ExternalLink,
  FolderKanban,
  LayoutList,
  ListChecks,
  Megaphone,
  SquareKanban,
} from 'lucide-react';
import type { API, ProjectGroup } from '../types';
import { trackerConnection } from '../domain/tracker';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { EmptyState } from './ui/empty-state';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { holdDialogFocus } from './dialog-parts';
import { GitHubProjectResources } from './github-project-resources';
import { GitHubProjectSettingsForm } from './github-project-settings';
import { SettingsDialogFrame, type SettingsSection } from './project-settings-sections';

export type BoardSettingsTab = 'fields' | 'views' | 'updates' | 'workflows' | 'github';
/** 'roadmap-dates' offers to create the "Start date" and "End date" fields on the Fields tab. */
export type BoardSettingsPreset = 'roadmap-dates';
const roadmapDates = ['Start date', 'End date'];

const tabs: SettingsSection<BoardSettingsTab>[] = [
  { value: 'fields', label: 'Fields', icon: <Columns3 /> },
  { value: 'views', label: 'Views', icon: <LayoutList /> },
  { value: 'updates', label: 'Status updates', icon: <Megaphone /> },
  { value: 'workflows', label: 'Workflows', icon: <ListChecks /> },
  { value: 'github', label: 'GitHub project', icon: <FolderKanban /> },
];

/**
 * The settings of the GitHub project that the board shows: fields, saved views, status updates,
 * workflows and the GitHub project itself. Kalkidan project settings are in Project settings.
 * Switches save at once. Forms with names and text have their own save button.
 */
export function BoardSettingsDialog({
  api,
  group,
  open,
  onOpenChange,
  tab = 'fields',
  preset,
  onChanged,
}: {
  api: API;
  group: ProjectGroup;
  open: boolean;
  onOpenChange(open: boolean): void;
  tab?: BoardSettingsTab;
  preset?: BoardSettingsPreset;
  /** Called after each write on GitHub, so that the page can load the board again. */
  onChanged?(): void;
}) {
  const connection = trackerConnection(group);
  const [active, setActive] = useState<BoardSettingsTab>(tab);
  useEffect(() => {
    if (open) setActive(tab);
  }, [open, tab]);
  const changed = () => onChanged?.();
  if (connection?.provider !== 'github')
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Board settings</DialogTitle>
            <DialogDescription className="sr-only">
              Board settings need a GitHub Projects board.
            </DialogDescription>
          </DialogHeader>
          <EmptyState
            icon={<SquareKanban />}
            title="No GitHub Projects board"
            action={
              <Button
                onClick={() => {
                  onOpenChange(false);
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-open-project-settings', {
                      detail: { groupId: group.id, section: 'board', tab: 'board' },
                    }),
                  );
                }}
              >
                Connect a board…
              </Button>
            }
          >
            Connect a GitHub Projects board to change its fields, views and workflows.
          </EmptyState>
        </DialogContent>
      </Dialog>
    );
  const resources = (kind: 'fields' | 'views' | 'statusUpdates' | 'workflows') => (
    <GitHubProjectResources
      key={kind}
      api={api}
      groupId={group.id}
      kind={kind}
      onChanged={changed}
    />
  );
  const panels: Partial<Record<BoardSettingsTab, ReactNode>> = {
    fields: (
      <div className="grid gap-6">
        <GitHubProjectResources
          api={api}
          groupId={group.id}
          kind="fields"
          dateFields={preset === 'roadmap-dates' ? roadmapDates : undefined}
          onChanged={changed}
        />
        <Collapsible className="project-settings-advanced">
          <CollapsibleTrigger className="project-settings-advanced-trigger">
            <ChevronRight aria-hidden="true" />
            Issue fields of the organization
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <GitHubProjectResources
              api={api}
              groupId={group.id}
              kind="issueFields"
              onChanged={changed}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>
    ),
    views: resources('views'),
    updates: resources('statusUpdates'),
    workflows: resources('workflows'),
    github: (
      <GitHubProjectSettingsForm
        api={api}
        groupId={group.id}
        onSaved={changed}
        onDeleted={() => onOpenChange(false)}
      />
    ),
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogFrame
        title="Board settings"
        description={`Changes apply to ${connection.project.title} on GitHub at once.`}
        sections={tabs}
        value={active}
        onValueChange={setActive}
        panels={panels}
        onOpenAutoFocus={holdDialogFocus}
        actions={
          connection.project.url ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={connection.project.url} target="_blank" rel="noreferrer">
                Open on GitHub
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          ) : undefined
        }
      />
    </Dialog>
  );
}

/**
 * Mount this one time. It opens Board settings for the `kalkidan-open-board-settings` event,
 * {groupId, tab?, preset?}. An event without a project is for `activeGroupId`.
 */
export function BoardSettingsHost({
  api,
  groups,
  activeGroupId,
  onChanged,
}: {
  api: API;
  groups: ProjectGroup[];
  activeGroupId?: string;
  /** Called after each write on GitHub. Without it, the host sends `kalkidan-github-writes`. */
  onChanged?(groupId: string): void;
}) {
  const [request, setRequest] = useState<{
    groupId: string;
    tab?: BoardSettingsTab;
    preset?: BoardSettingsPreset;
  }>();
  const latest = useRef({ groups, activeGroupId });
  latest.current = { groups, activeGroupId };
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          groupId?: string;
          tab?: BoardSettingsTab;
          preset?: BoardSettingsPreset;
        }>
      ).detail;
      const groupId = detail?.groupId || latest.current.activeGroupId;
      if (!groupId || !latest.current.groups.some((group) => group.id === groupId)) return;
      setRequest({ groupId, tab: detail?.tab, preset: detail?.preset });
    };
    window.addEventListener('kalkidan-open-board-settings', onOpen);
    return () => window.removeEventListener('kalkidan-open-board-settings', onOpen);
  }, []);
  const group = request && groups.find((item) => item.id === request.groupId);
  if (!group) return null;
  return (
    <BoardSettingsDialog
      api={api}
      group={group}
      open
      tab={request?.tab}
      preset={request?.preset}
      onOpenChange={(open) => !open && setRequest(undefined)}
      onChanged={() =>
        onChanged
          ? onChanged(group.id)
          : window.dispatchEvent(
              new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
            )
      }
    />
  );
}
