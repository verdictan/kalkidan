import type { API } from '../types';
import type { SettingsTab } from '../domain/settings-route';
import { SettingsDialog } from './settings-dialog';

export { SettingsDialog } from './settings-dialog';

/** A request to move the focus in Settings. A new `request` moves it again. */
export interface SettingsFocus {
  /** The element ID. Empty opens the section at the top. */
  id: string;
  request: number;
}

/**
 * @deprecated Settings is now a dialog. Mount `SettingsDialog` from './settings-dialog'.
 * This wrapper shows the dialog for the older Settings route. Closing it goes back.
 */
export function SettingsPage({
  api,
  tab,
  focus,
  onRefresh,
}: {
  api: API;
  tab: SettingsTab;
  focus?: SettingsFocus;
  onTab?: (tab: SettingsTab) => void;
  onNavigate?: (tab: SettingsTab, anchor?: string) => void;
  onRefresh?: () => Promise<void>;
}) {
  return (
    <SettingsDialog
      key={focus?.request}
      api={api}
      open
      section={tab}
      anchor={focus?.id || undefined}
      onRefresh={onRefresh}
      onOpenChange={(open) => !open && window.history.back()}
    />
  );
}
