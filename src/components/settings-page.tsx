import { SettingsBody, useCloseOnEscape, type SettingsBodyProps } from './settings-dialog';

export { SettingsDialog, SettingsBody } from './settings-dialog';

/** A request to move the focus in Settings. A new `request` moves it again. */
export interface SettingsFocus {
  /** The element ID. Empty opens the part at the top. */
  id: string;
  request: number;
}

/**
 * The one Settings page (⌘,). The shell shows it in the main column, under its 48px
 * "Settings" header. `section` and `anchor` move to a part: 'account', 'tools', 'preferences'
 * or 'project:<id>' (older names work too). Escape calls `onClose`.
 */
export function SettingsPage({
  tab,
  focus,
  section,
  anchor,
  onClose,
  ...props
}: Omit<SettingsBodyProps, 'request'> & {
  /** @deprecated Use `section`. */
  tab?: SettingsBodyProps['section'];
  /** @deprecated Use `anchor`. */
  focus?: SettingsFocus;
  /** Leaves the page, for example back to the page before. */
  onClose?: () => void;
  onTab?: (tab: string) => void;
  onNavigate?: (tab: string, anchor?: string) => void;
}) {
  useCloseOnEscape(() => onClose?.());
  return (
    <div className="st-scroll st-embedded">
      <SettingsBody
        {...props}
        section={section ?? tab}
        anchor={anchor ?? (focus?.id || undefined)}
        request={focus?.request}
      />
    </div>
  );
}
