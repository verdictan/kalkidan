// One look for every menu: dropdown, context and editor menus share these classes.
/** Open and close motion for menus, select lists and popovers (reduced motion: no motion). */
export const menuMotionClass =
  'duration-[var(--motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0';
/**
 * The two menu widths. Default 224px. Wide 256px, for menus with shortcuts or long names. A
 * menu grows past its width when an item needs more space, so items never truncate.
 */
export const menuWidthClass = 'w-[var(--menu-width)] min-w-fit';
export const menuWideClass = 'w-[var(--menu-width-wide)] min-w-fit';
/** The menu surface without a width. Menus set menuWidthClass or menuWideClass. */
export const menuSurfaceClass =
  'z-[var(--z-popover)] overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md ' +
  menuMotionClass;
/** The menu surface at the default width. */
export const menuContentClass = menuSurfaceClass + ' ' + menuWidthClass;
/** A 28px item with a 14px muted icon. Destructive items set `--menu-icon` to red. */
export const menuItemClass =
  "relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-hidden select-none focus:bg-[var(--surface-selected)] focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=open]:bg-[var(--surface-selected)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-[var(--menu-icon,var(--muted-foreground))]";
/** One group-label style for menus, select lists, the sidebar and settings: 11/16, 600. */
export const menuLabelClass = 'group-label px-2 pt-2 pb-1';
/** Destructive items in dropdown and context menus. */
export const menuDestructiveClass =
  'text-destructive [--menu-icon:var(--destructive)] focus:bg-destructive/10 focus:text-destructive';
export const menuSeparatorClass = '-mx-1 my-1 h-px bg-border';
export const menuShortcutClass = 'ml-auto pl-4 text-xs text-muted-foreground';
/**
 * The space that menus, select lists and tooltips keep from the window edges. The top value
 * is larger: the title bar and the macOS window controls are at the top of the window. Keep it
 * equal to `--titlebar-height` in theme.css plus a small gap.
 */
export const menuCollisionPadding = { top: 52, right: 8, bottom: 8, left: 8 };
