// One look for every menu: dropdown, context and editor menus share these classes.
/** Open and close motion for menus, select lists and popovers (reduced motion: no motion). */
export const menuMotionClass =
  'duration-[var(--motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0';
export const menuContentClass =
  'z-50 min-w-[12rem] overflow-x-hidden overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md ' +
  menuMotionClass;
export const menuItemClass =
  "relative flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-hidden select-none focus:bg-[var(--surface-selected)] focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=open]:bg-[var(--surface-selected)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted-foreground";
export const menuLabelClass = 'px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground';
/** Destructive items in dropdown and context menus. */
export const menuDestructiveClass =
  'text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20 [&_svg]:!text-destructive';
export const menuSeparatorClass = '-mx-1 my-1 h-px bg-border';
export const menuShortcutClass = 'ml-auto pl-4 text-xs text-muted-foreground';
