import { useEffect, useRef } from 'react';
import type { API, ProjectGroup } from '../types';
import { ConnectBoardHost } from './tracker-project-picker';

/** The old Board settings tabs. They all open Project settings › Board now. */
export type BoardSettingsTab = 'fields' | 'views' | 'updates' | 'workflows' | 'github';
/** 'roadmap-dates' shows the row that adds the "Start date" and "End date" fields. */
export type BoardSettingsPreset = 'roadmap-dates';

/** Opens Project settings › Board for a project. */
export function openBoardSettings(groupId: string, preset?: BoardSettingsPreset) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-settings', {
      detail: { groupId, section: 'board', tab: preset || 'board' },
    }),
  );
}

/**
 * Board settings are in Project settings › Board. This wrapper opens that section when `open`
 * becomes true, then reports itself closed, so that old callers keep working.
 */
export function BoardSettingsDialog({
  group,
  open,
  onOpenChange,
  preset,
}: {
  api?: API;
  group: ProjectGroup;
  open: boolean;
  onOpenChange(open: boolean): void;
  tab?: BoardSettingsTab;
  preset?: BoardSettingsPreset;
  onChanged?(): void;
}) {
  useEffect(() => {
    if (!open) return;
    openBoardSettings(group.id, preset);
    onOpenChange(false);
  }, [open]);
  return null;
}

/**
 * Mount this one time. It opens Project settings › Board for the `kalkidan-open-board-settings`
 * event, {groupId, tab?, preset?}. An event without a project is for `activeGroupId`. It also
 * shows the Connect board dialog for `openConnectBoard`.
 */
export function BoardSettingsHost({
  api,
  groups,
  activeGroupId,
  onChanged,
}: {
  api?: API;
  groups: ProjectGroup[];
  activeGroupId?: string;
  /** Reloads the app data after a project connects to a board. */
  onChanged?(groupId: string): void | Promise<void>;
}) {
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
      openBoardSettings(groupId, detail?.preset);
    };
    window.addEventListener('kalkidan-open-board-settings', onOpen);
    return () => window.removeEventListener('kalkidan-open-board-settings', onOpen);
  }, []);
  return <ConnectBoardHost api={api} groups={groups} onChanged={onChanged} />;
}
